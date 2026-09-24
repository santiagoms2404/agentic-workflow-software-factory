// The pi/Codex adapter: ChatGPT Plus as the second first-class worker route,
// through the `pi` CLI on its `openai-codex` provider, with the prompt on stdin
// and the model identity recorded for exactly as much as it is worth — which on
// this route is less than the first pass claimed. See below.
//
// Two halves, and the split is the same discipline T13's adapter follows:
//
//   `buildSpec` is PURE. It is asserted down to exact argv without any child
//   ever starting, which is what makes "the prompt never rides argv" a
//   descriptor test rather than a code review. The flag list is pinned to
//   `specs/awsf-plan.html` § "The five adapters and their real flags" and to the
//   reviewed builder at `fusion-harness/…/launch.ts:147-181`, and was
//   reconciled against `pi --help` on 0.81.1.
//
//   `parse` turns the CLI's `--mode json` line stream into the twelve
//   normalized event kinds, via `PiStreamDecoder`. Every run-level invariant —
//   one terminal, explicit tool settlement, host-minted tool ids, `null ≠ 0`,
//   fail-closed identity — belongs to `EventSequencer`, so this file and its
//   decoder inherit them rather than re-implementing them.
//
// ---------------------------------------------------------------------------
// What makes this route DIFFERENT from T13's — as corrected by the GPT
// cross-building review, which found this header asserting two things that are
// not true. Both corrections run in the same direction, and it is worth naming
// the direction: a same-family session wrote down the STRONGEST reading of the
// evidence each time, and the reviewer from the other family found the evidence
// did not reach that far.
//
//   · `costAuthority: "catalog-estimate"`, not `"provider"`. pi does report a
//     per-turn figure, but `calculateCost` computes it here — rate per million
//     from the model's entry in pi's LOCAL store, times the token counts.
//     OpenAI reports tokens and no charge. So this route renders `≈ $0.01`, an
//     estimate marked as one, and the only thing it has over Claude Pro's
//     `— subscription` is a number. See `cost-display.ts`.
//   · `reasoningRelation: "included-in-output"` stands, but as a READING of
//     pi's own mapping rather than as a measurement. The capture reported
//     `reasoning: 0` on every turn, which is consistent with either relation
//     and therefore confirms neither.
//
// The third correction is in the decoder: `model.resolved` from this route is
// `route-attributed`, because pi builds the assistant message from its local
// model config and never reads the API's own `response.model` back.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AdapterError,
  type Availability,
  type ContinuityCapableAdapter,
  type ContinuityEvidence,
  type ContinuityRef,
  type ModelInfo,
  type ModelRequest,
  type ObservedProviderSession,
  type ObservedToolImage,
  type BrokerProcessRegistration,
  type ProcessSpec,
  type ProcessTransport,
  type TransportBroker,
} from "./interface.ts";
import { filterEnv } from "./env.ts";
import { assertPrivateSystemPrompt } from "./system-prompt-file.ts";
import { resolvePermissionProfile } from "../policy/permission-profiles.ts";
import { PiStreamDecoder, type PiSessionRecord } from "./pi-codex-stream.ts";
import { isTerminalKind, type NormalizedEvent } from "../contracts/normalized-events.ts";
import type { UnionOf } from "../contracts/typebox.ts";
import { LineFramer } from "./stream/line-framer.ts";
import { EventSequencer } from "./stream/event-sequencer.ts";
import { OutputBudget, type OutputBudgetOptions } from "./stream/output-budget.ts";
import {
  DEFAULT_EXIT_WAIT_MS,
  awaitExit,
  drainStderr,
  stderrSuffix,
} from "./stream/transport-loop.ts";

export { writeSystemPromptFile } from "./system-prompt-file.ts";
export type { PiSessionRecord } from "./pi-codex-stream.ts";

export const PI_ADAPTER_ID = "pi-codex";

/**
 * The ROUTE behind the CLI, and it is pinned rather than configured.
 *
 * `awsf.config.yaml` names the same value (`adapters.codex.provider`), but a
 * different provider through the same binary is a different protocol, a
 * different auth path, and a different set of captured bytes — none of which
 * this adapter has. Accepting one from config would let an unreviewed route
 * inherit a reviewed adapter's descriptor tests.
 */
export const PI_PROVIDER = "openai-codex";

/**
 * Model selectors arrive as `codex:gpt-5.6-sol` from `awsf.config.yaml` §
 * agents — where `codex` is that file's ALIAS for this adapter — and as
 * `gpt-5.6-sol` from anything that already resolved the route. Mapping an alias
 * to an adapter is the registry's job (T15); stripping the one this repo's
 * config actually writes is this adapter's.
 */
export const PI_MODEL_PREFIX = "codex:";

/**
 * Leading alphanumeric, then the punctuation real Codex selectors use —
 * `gpt-5.6-sol`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`.
 *
 * Deliberately narrower than `REPRESENTABLE_IDENTITY`, and narrower in two ways
 * that are load-bearing for THIS CLI in particular:
 *
 *   · no `/` — `pi --model` accepts a `provider/id` form, so a selector with a
 *     slash in it would name a second provider from inside a flag that has
 *     already been told which provider to use, and `--provider` would lose.
 *   · no `:` — `pi --model` accepts an `id:<thinking>` shorthand, so a colon
 *     would set the thinking level from the model field and silently outrank
 *     the `--thinking` this adapter puts on the line from the agent's config.
 *
 * Both are refusals rather than sanitizations: a selector that meant something
 * other than what it says is a request the caller should fix.
 */
const SAFE_MODEL_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `--thinking` levels the CLI accepts (`pi --help`, 0.81.1). */
export const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type PiThinking = UnionOf<typeof PI_THINKING_LEVELS>;

/**
 * `awsf.config.yaml` § agents declares `thinking: none`, and — unlike the Claude
 * CLI, where T13 had to floor it at `low` — pi has a real off switch. So `none`
 * maps to `off` and the harness says what it means. The alias exists only to
 * translate this repo's config vocabulary; every level pi names passes through
 * untouched.
 */
const THINKING_ALIASES: Readonly<Record<string, PiThinking>> = Object.freeze({
  none: "off",
});

/**
 * pi's built-in tool names, read off the CLI's own tool definitions
 * (`packages/coding-agent/src/core/tools/*.ts` in the 0.80.3 checkout — the
 * installed CLI is 0.81.1; see the decoder's header on why the two are kept
 * apart) rather than guessed:
 * `bash`, `edit`, `find`, `grep`, `ls`, `read`, `write`. Lowercase, and not
 * interchangeable with the Claude adapter's `Read,Glob,Grep`.
 */
export const PI_READONLY_TOOLS: readonly string[] = Object.freeze(["read", "grep", "find", "ls"]);
export const PI_MANAGED_WORKER_TOOLS: readonly string[] = Object.freeze([
  ...PI_READONLY_TOOLS,
  "bash",
  "edit",
  "write",
]);

/**
 * `openai-codex` models that take no image input, read off `pi --list-models`
 * on 0.87.1 (its `images` column). `supportsImages` is a claim visual work
 * relies on, so a model the table marks text-only is reported as one rather
 * than inheriting the route's default.
 */
export const PI_TEXT_ONLY_MODELS: readonly string[] = Object.freeze(["gpt-5.3-codex-spark"]);

/** The profile vocabulary of `awsf.config.yaml` § `agents[].tools.profile`. */
export const PI_TOOL_PROFILES = ["readonly", "managed-worker", "no-tools"] as const;
export type PiToolProfile = UnionOf<typeof PI_TOOL_PROFILES>;

/** The default when a caller states no profile: the narrowest one that exists. */
export const DEFAULT_TOOL_PROFILE: PiToolProfile = "readonly";

/**
 * Gate commands are host-run subprocesses, never provider tool calls. A request
 * that asks this adapter to execute a gate is asking it to enforce a ceiling it
 * has no way to enforce, so it refuses instead of approximating.
 */
const HOST_ONLY_PROFILE = "gate-execute";

/**
 * The tool ceiling, as flags.
 *
 * T13's adapter takes a deliberate DEVIATION here — it carries
 * `--disallowed-tools` on the `no-tools` profile as well, because Claude Code's
 * narrowest profile is expressed as `--tools ""` and an empty value that is
 * ever read as "flag not set" turns the strictest profile into the widest one.
 *
 * That deviation does NOT carry over, and the reason is worth writing down so
 * the next reader does not "fix" the asymmetry: pi's narrowest profile is
 * `--no-tools`, a boolean flag whose presence is unambiguous. There is no empty
 * string to be misread, so there is nothing for a second flag to remove. The
 * reviewed argv is kept exactly.
 */
function permissionArgs(adapter: string, profile: string, configuredTools?: readonly string[]): readonly string[] {
  if (profile === HOST_ONLY_PROFILE) {
    throw new AdapterError(
      adapter,
      "E_POLICY_CEILING_UNENFORCEABLE",
      "gate execution is host-only; no provider profile can enforce it",
    );
  }
  const exactTools = configuredTools === undefined
    ? undefined
    : resolvePermissionProfile(profile, configuredTools, []).tools;
  const piTools = exactTools === undefined
    ? undefined
    : [...new Set(exactTools.map((tool) => tool === "exec" ? "bash" : tool))];
  switch (profile) {
    case "no-tools":
      return ["--no-tools"];
    case "managed-worker":
      return ["--tools", piTools?.join(",") ?? PI_MANAGED_WORKER_TOOLS.join(",")];
    case "readonly":
      return ["--tools", piTools?.join(",") ?? PI_READONLY_TOOLS.join(",")];
    default:
      throw new AdapterError(
        adapter,
        "E_INVALID_REQUEST",
        `no tool profile named ${JSON.stringify(profile)}; this adapter knows ` +
          `${PI_TOOL_PROFILES.join(", ")}`,
      );
  }
}

/** `codex:gpt-5.6-sol` and `gpt-5.6-sol` are the same route; anything else fails closed. */
export function selectorFor(model: string): string {
  const name = model.startsWith(PI_MODEL_PREFIX) ? model.slice(PI_MODEL_PREFIX.length) : model;
  if (!SAFE_MODEL_SELECTOR.test(name)) {
    throw new AdapterError(
      PI_ADAPTER_ID,
      "E_MODEL_UNRESOLVED",
      `${JSON.stringify(model)} is not a model selector this adapter can put on a command line`,
    );
  }
  return name;
}

/**
 * The session flags, and the reason `open` and `resume` produce the SAME three
 * arguments is worth stating rather than leaving as a coincidence: pi's
 * `--session-id` creates the session when it is missing and opens it when it is
 * present, so one argv covers both turns and the descriptor test can assert
 * byte-equality between them.
 *
 * What differs between the two turns is therefore not the command line at all —
 * it is the host's `assertResumable` proof, which runs before the resume and
 * not before the open. That asymmetry is deliberate: it puts the burden on the
 * host, which can fail closed for free, rather than on the CLI, which fails
 * open by design.
 */
function sessionArgs(continuity: ModelRequest["continuity"]): readonly string[] {
  if (continuity === undefined) return ["--no-session"];
  const { providerSessionId, storeDir } = continuity.ref;
  if (!PI_SESSION_ID.test(providerSessionId)) {
    throw new AdapterError(
      PI_ADAPTER_ID,
      "E_INVALID_REQUEST",
      `${JSON.stringify(providerSessionId)} is not a session id this CLI accepts`,
    );
  }
  if (storeDir === null || storeDir.length === 0) {
    throw new AdapterError(
      PI_ADAPTER_ID,
      "E_INVALID_REQUEST",
      "this route keeps its sessions in a host-owned directory; none was supplied",
    );
  }
  return ["--session-id", providerSessionId, "--session-dir", storeDir];
}

export function thinkingFor(level: string): PiThinking {
  const resolved = THINKING_ALIASES[level] ?? level;
  if (!(PI_THINKING_LEVELS as readonly string[]).includes(resolved)) {
    throw new AdapterError(
      PI_ADAPTER_ID,
      "E_INVALID_REQUEST",
      `no thinking level named ${JSON.stringify(level)}; the CLI accepts ` +
        `${PI_THINKING_LEVELS.join(", ")}`,
    );
  }
  return resolved as PiThinking;
}

// ---------------------------------------------------------------------------
// Continuity: the verified `--session-id` / `--session-dir` protocol.
// ---------------------------------------------------------------------------

/**
 * The subdirectory of a phase's private runtime directory that pi is told to
 * keep this phase's conversation in.
 *
 * Naming it at all is the point. pi's default store is
 * `~/.pi/agent/sessions/--<encoded-cwd>--/`, which would put a worker's full
 * transcript in the operator's home directory for the lifetime of the machine.
 * `--session-dir` moves it inside the attempt's own `private/` tree, where the
 * host already owns the mode bits and `awsf gc` already knows how to find it.
 */
export const PI_SESSION_DIR_NAME = "pi-sessions";

/**
 * pi's session id rule, transcribed from `assertValidSessionId`
 * (`core/session-manager.js:15-19` in the installed 0.81.1): alphanumeric plus
 * `. _ -`, starting and ending alphanumeric.
 *
 * Re-stated here rather than assumed, because the failure it prevents is
 * silent: `--session-id` is validated by the CLI with `process.exit(1)` and a
 * message on stderr, which from the host's side is a launch that spent its
 * process and produced no terminal event.
 */
const PI_SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * The one line of pi's session format this adapter depends on, and it is the
 * documented one: `docs/session-format.md` § SessionHeader pins the first line
 * of every session file to `{"type":"session","version":3,"id":…,"cwd":…}`.
 *
 * Everything else about the file is pi's business. The host reads the header to
 * answer one question — is the conversation this correction claims to re-enter
 * actually here, under this id, for this working directory — and reads the
 * entry roles to answer the second: did it get an answer already. A resume of a
 * session with no assistant turn in it would be a cold start with extra steps.
 */
interface PiSessionFileFacts {
  readonly path: string;
  readonly cwd: string;
  readonly assistantTurns: number;
}

function readPiSessionFile(path: string, expectedId: string): PiSessionFileFacts | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  let header: { type?: unknown; id?: unknown; cwd?: unknown } | null = null;
  let assistantTurns = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    let entry: { type?: unknown; id?: unknown; cwd?: unknown; message?: { role?: unknown } };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      // pi's own reader skips malformed lines; a host that refused here would
      // be stricter about the file than the tool that writes it.
      continue;
    }
    if (header === null) {
      if (entry.type !== "session" || typeof entry.id !== "string") return null;
      if (entry.id !== expectedId) return null;
      header = entry;
      continue;
    }
    if (entry.type === "message" && entry.message?.role === "assistant") assistantTurns += 1;
  }
  if (header === null || typeof header.cwd !== "string") return null;
  return { path, cwd: header.cwd, assistantTurns };
}

/**
 * Whether a correction re-entered the session it claims to be correcting.
 *
 * This is the whole of "no cold restart disguised as a correction". The plan's
 * escalation ladder makes an intra-phase correction cost tokens rather than a
 * tier call precisely BECAUSE it re-enters a live session with the context
 * intact; a correction that quietly started a fresh session would be a state
 * transition wearing a cheaper price tag, and nothing downstream could tell.
 *
 * No new error code was invented for it, and the two it uses are the two T13
 * uses for the same two facts: a different model is `E_MODEL_MISMATCH`, which
 * the sequencer already raises for the same fact arriving mid-run, and a
 * different session is a transport-level failure of the continuity the adapter
 * promised, which is `E_BACKEND_FAILURE`.
 */
export function assertSameSession(first: PiSessionRecord, next: PiSessionRecord): void {
  if (first.resolvedModel !== next.resolvedModel) {
    throw new AdapterError(
      PI_ADAPTER_ID,
      "E_MODEL_MISMATCH",
      `the correction answered on ${JSON.stringify(next.resolvedModel)} but the phase ` +
        `began on ${JSON.stringify(first.resolvedModel)}; a phase answers on one model`,
    );
  }
  if (first.sessionId === null || next.sessionId === null || first.sessionId !== next.sessionId) {
    throw new AdapterError(
      PI_ADAPTER_ID,
      "E_BACKEND_FAILURE",
      `the correction ran in provider session ${JSON.stringify(next.sessionId)} rather than ` +
        `${JSON.stringify(first.sessionId)}; a correction re-enters the session it corrects`,
    );
  }
}

export interface PiParseOptions {
  /** What the host ASKED for. The stream says what answered; the two are different facts. */
  requestedModel?: string;
  /** Filled in as the stream names the session, the model, and the price. */
  session?: PiSessionRecord;
  /** Filled with image tool results, by digest, when the caller asks. */
  images?: ObservedToolImage[];
}

export interface PiCodexAdapterOptions {
  /** The executable NAME; the broker resolves it against PATH. */
  executable?: string;
  /** Host observation time. Injected so a replayed transcript is byte-stable. */
  now?: () => string;
  limits?: OutputBudgetOptions;
  /**
   * How long a settled run waits for the process to actually exit, so its exit
   * code is measured rather than assumed. Injected only so the expiry path — a
   * child that closes stdout and then hangs — is a test rather than a hope.
   */
  exitWaitMs?: number;
}

export class PiCodexAdapter implements ContinuityCapableAdapter {
  readonly id = PI_ADAPTER_ID;
  /**
   * The transport-side half of the continuity claim, and it is a separate
   * assertion from `getModelInfo().continuity` on purpose — see
   * `isContinuityCapable`.
   */
  readonly supportsSameSessionCorrection = true as const;
  readonly #executable: string;
  readonly #now: () => string;
  readonly #limits: OutputBudgetOptions;
  readonly #exitWaitMs: number;

  constructor(options: PiCodexAdapterOptions = {}) {
    this.#executable = options.executable ?? "pi";
    this.#now = options.now ?? ((): string => new Date().toISOString());
    this.#limits = options.limits ?? {};
    this.#exitWaitMs = options.exitWaitMs ?? DEFAULT_EXIT_WAIT_MS;
  }

  /**
   * Available if the executable is a name the broker can resolve.
   *
   * Deliberately does NOT run `pi --version`: an availability check that spawns
   * is a provider process the host never registered, and this adapter is not
   * allowed to start one. Whether the binary exists is the broker's answer to
   * give, at launch, where a failure is already a run.
   */
  async isAvailable(): Promise<Availability> {
    if (this.#executable.length === 0 || /[\s/\\]/.test(this.#executable)) {
      return {
        status: "blocked",
        code: "E_INVALID_REQUEST",
        detail: `${JSON.stringify(this.#executable)} is not a resolvable executable name`,
      };
    }
    return { status: "available" };
  }

  /**
   * `costAuthority: "catalog-estimate"`, and the demotion from `"provider"` is
   * the single most important correction the cross-building review produced.
   *
   * The first pass read pi's per-turn `cost` block, saw a real number with a
   * provider's name on it, and called it a provider-reported price — the first
   * route in this harness whose cost rendered as money. It is not one.
   * `calculateCost` (`packages/ai/src/models.ts:385`) is arithmetic and nothing
   * else: rate per million from the model's entry in pi's LOCAL model store,
   * multiplied by the token counts. OpenAI reports tokens; it reports no charge.
   * So the figure is an estimate computed on this machine from a rate card that
   * ships with the CLI, which is precisely what `catalog-estimate` means — and
   * it now renders `≈ $0.01` rather than `$0.01`.
   *
   * The distinction is the entire reason `cost-display.ts` exists. Having built
   * that file to stop a subscription route showing `$0.00`, the first pass then
   * let an arithmetic estimate wear a confirmed price's clothes on the very next
   * adapter. `usageAuthority` stays `"provider"`: the TOKENS are measured and
   * reported: only the money is derived.
   *
   * `continuity: "same-session-correction"` is the second correction, and it is
   * a promise being RE-EARNED rather than restored on trust. The earlier value
   * was `"none"`, written when this adapter pinned `--no-session`, and the note
   * that replaced it said the declaration would become true again on the day a
   * transport existed. That day is this one, and what makes it true is a
   * protocol read off the installed CLI rather than inferred from a comment:
   *
   *   · `--session-id <id>` — "Use exact project session ID, creating it if
   *     missing" (`pi --help`, 0.81.1). `main.js:264-271` resolves it by exact
   *     id within the current cwd and `SessionManager.open`s the file it finds,
   *     so the second turn re-enters the first turn's context.
   *   · `--session-dir <dir>` — the store that lookup searches
   *     (`main.js:450-454`, `session-manager.js:1281-1288`), which is what lets
   *     the transcript live inside the attempt's private tree instead of the
   *     operator's home.
   *   · `--no-session` is GONE from the continuity spec, and had to be: it wins
   *     outright (`main.js:206-208` returns an in-memory session before
   *     `--session-id` is ever consulted), which is exactly why the earlier
   *     declaration was honest at the time.
   *
   * The one sharp edge is that a missing session is a WARNING on stderr and a
   * fresh session with the requested id, not a refusal — a cold start wearing
   * the resume's name. `assertResumable` is the answer, and it runs on the
   * host, before the launch, against the host's own session directory.
   *
   * `contextWindow: null` means this adapter declares no ceiling — not that the
   * ceiling is zero. pi's local model store knows the real number; reading it
   * would make this adapter depend on the CLI's private state, and the catalog
   * that owns the number is T15's.
   */
  async getModelInfo(model: string): Promise<ModelInfo> {
    const requestedModel = selectorFor(model);
    return {
      adapter: this.id,
      provider: PI_PROVIDER,
      requestedModel,
      contextWindow: null,
      supportsThinking: true,
      supportsTools: true,
      supportsImages: !PI_TEXT_ONLY_MODELS.includes(requestedModel),
      continuity: "same-session-correction",
      usageAuthority: "provider",
      costAuthority: "catalog-estimate",
    };
  }

  /**
   * pi 0.87.1 reads its credentials and settings only after taking a lock it
   * creates beside them (`mkdir auth.json.lock`, `settings.json.lock`), so a
   * read-only agent directory ends every run before the model is called:
   * `EROFS … auth.json.lock`, measured under bwrap on 2026-09-23. The directory
   * is the one pi resolves from the child's HOME — AWSF passes no
   * `PI_CODING_AGENT_DIR` — and it is the only host path this route needs.
   */
  providerWritableRoots(env: Readonly<Record<string, string | undefined>>): readonly string[] {
    const home = env["HOME"];
    return home === undefined || home.length === 0 ? [] : [join(home, ".pi", "agent")];
  }

  /** pi has `--session-dir`, so its transcript stays inside the attempt. */
  continuityStoreDir(runtimeDir: string): string {
    return join(runtimeDir, PI_SESSION_DIR_NAME);
  }

  /**
   * Host-side, pre-launch proof that a resume will resume.
   *
   * Reads the directory the host itself handed the CLI — never pi's default
   * store — so this depends on nothing about where pi would otherwise keep
   * state. Inside it, the file must exist under the exact id, carry the exact
   * working directory in its header, and already contain an assistant turn.
   *
   * All three matter and none is redundant. A missing file is the documented
   * warn-and-create path. A different cwd is a session pi would not find (its
   * own lookup filters by cwd, `session-manager.js:1283-1285`), so resuming it
   * would silently create a second one. And a session with no assistant turn
   * has nothing to correct — it is a first turn that never answered, and
   * treating it as a resume would bill a cold start as a continuation.
   */
  assertResumable(ref: ContinuityRef, context: { readonly cwd: string }): ContinuityEvidence {
    const refuse = (detail: string): never => {
      throw new AdapterError(
        this.id,
        "E_BACKEND_FAILURE",
        `refusing to resume: ${detail}; a correction re-enters the session it corrects`,
      );
    };
    if (ref.storeDir === null) {
      return refuse("this route keeps its sessions in a host-owned directory and none was given");
    }
    if (!PI_SESSION_ID.test(ref.providerSessionId)) {
      return refuse("the continuity reference is not a session id this CLI accepts");
    }
    let names: readonly string[];
    try {
      names = readdirSync(ref.storeDir);
    } catch {
      return refuse("the host-owned session directory does not exist");
    }
    const expectedCwd = resolve(context.cwd);
    const found: PiSessionFileFacts[] = [];
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const facts = readPiSessionFile(join(ref.storeDir, name), ref.providerSessionId);
      if (facts !== null) found.push(facts);
    }
    if (found.length === 0) {
      return refuse(`no session in the host-owned store carries the expected id`);
    }
    if (found.length > 1) {
      // Two files claiming one id is not a state the host may pick a winner
      // from: pi's own lookup takes the most recently modified, and a
      // correction that resumed whichever that happened to be would be a
      // different conversation on a different day.
      return refuse(`${found.length} session files claim the expected id`);
    }
    const session = found[0]!;
    if (resolve(session.cwd) !== expectedCwd) {
      return refuse("the stored session belongs to a different working directory");
    }
    if (session.assistantTurns === 0) {
      return refuse("the stored session has no assistant turn to correct");
    }
    return Object.freeze({
      proof: "host-visible-session-store" as const,
      detail: `${session.assistantTurns} prior assistant turn(s) in the host-owned session store`,
    });
  }

  /**
   * PURE. Spawns nothing, reads nothing, and is asserted down to exact argv.
   *
   * The flag ORDER is part of the assertion, not an accident of construction: a
   * descriptor test that accepted any permutation would accept an argv nobody
   * reviewed, and this list is the reviewed one.
   *
   * The five clean-room flags are not cosmetic. `--no-extensions` is
   * LOAD-BEARING — it stops a child recursively loading this harness's own pi
   * extensions (`launch.ts:139-141`) — and the other four remove the machine's
   * ambient state from the run: a skill, a prompt template, a theme, or an
   * `AGENTS.md` discovered from the worktree would make two runs of the same
   * phase on two machines different runs.
   */
  buildSpec(request: ModelRequest): ProcessSpec {
    const argv: string[] = [
      "--mode",
      "json",
      "-p",
      "--provider",
      PI_PROVIDER,
      "--model",
      selectorFor(request.model),
      ...sessionArgs(request.continuity),
    ];
    if (request.effort !== undefined) argv.push("--thinking", thinkingFor(request.effort));
    if (request.systemPromptPath !== undefined) {
      // pi's flag takes text OR a file path and decides by `existsSync`, so a
      // path that is not there is appended as its own literal string rather
      // than refused — the system prompt silently becomes `/tmp/…/x.md`. The
      // existence check therefore has to happen on the host side, and it does:
      // `execute` calls `assertPrivateSystemPrompt`, which fails an unreadable
      // path with `E_INVALID_REQUEST` before any child starts.
      argv.push("--append-system-prompt", request.systemPromptPath);
    }
    argv.push(
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
    );
    argv.push(...permissionArgs(this.id, request.profile ?? DEFAULT_TOOL_PROFILE, request.tools));
    return {
      executable: this.#executable,
      argv: Object.freeze(argv),
      cwd: request.cwd,
      env: filterEnv(this.id, request.env),
      // The prompt. NEVER argv — pi reads piped stdin as the initial message
      // (`main.ts:761-774`), which is exactly the property this harness needs.
      stdin: request.prompt,
      shell: false,
    };
  }

  /**
   * Describe, hand to the broker, parse. The adapter never starts anything
   * itself — and it never starts anything TWICE. There is no retry here, which
   * is what makes "quota is never a retry" structural rather than a policy
   * somebody has to remember: a run that ends `E_QUOTA_EXHAUSTED` ends, and the
   * decision about what happens next belongs to a layer that can see the
   * budget.
   */
  /** Delegates to the module-level function so adapter tests and the runner share one rule. */
  assertSameSession(first: ObservedProviderSession, next: ObservedProviderSession): void {
    assertSameSession(
      { sessionId: first.sessionId, resolvedModel: first.resolvedModel, costUsd: first.costUsd ?? null },
      { sessionId: next.sessionId, resolvedModel: next.resolvedModel, costUsd: next.costUsd ?? null },
    );
  }

  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: AbortSignal,
    observed?: ObservedProviderSession,
  ): AsyncIterable<NormalizedEvent> {
    if (request.systemPromptPath !== undefined) {
      // Load-bearing on this route in a way it is not on T13's: pi's
      // `--append-system-prompt` falls back to treating its value as literal
      // TEXT when the path does not exist, so an unreadable file would launch a
      // run whose system prompt is the string `/tmp/…/system-prompt.md`. This
      // refuses it before any child starts.
      assertPrivateSystemPrompt(this.id, request.systemPromptPath);
    }
    const transport = await broker.startProcess(registration, this.buildSpec(request), signal);
    // The decoder fills this in as the stream names itself. Copied back on the
    // way out — including on a failed or cancelled stream, because "which
    // conversation was that" is exactly the question a failure raises.
    const record: PiSessionRecord = { sessionId: null, resolvedModel: null, costUsd: null };
    try {
      yield* this.parse(transport, signal, { requestedModel: selectorFor(request.model), session: record,
        ...(observed?.images === undefined ? {} : { images: observed.images }) });
    } finally {
      if (observed !== undefined) {
        observed.sessionId = record.sessionId;
        observed.resolvedModel = record.resolvedModel;
        observed.costUsd = record.costUsd;
      }
    }
  }

  /**
   * Yields a decoded terminal with the process's real exit code in it.
   *
   * The exit code is MEASURED rather than assumed at the moment the decoder saw
   * a terminal line: a CLI that prints a success terminal and then exits
   * non-zero was being recorded as clean. Holding the terminal costs nothing in
   * ordering — the sequencer emits nothing after one — and `null` stays `null`
   * when the process does not exit in time, because a run whose exit nobody saw
   * did not exit cleanly, it exited unobserved.
   *
   * It is a method rather than two inline copies because BOTH exits from the
   * read loop have to go through it. When only the happy path did, a stream
   * that broke after the provider had already settled lost its terminal.
   */
  async *#settleHeld(
    transport: ProcessTransport,
    held: NormalizedEvent,
  ): AsyncIterable<NormalizedEvent> {
    const exit = await awaitExit(transport, this.#exitWaitMs);
    yield held.kind === "run.completed" ? { ...held, exitCode: exit?.code ?? null } : held;
  }

  /**
   * Bytes to normalized events, through the three stream-layer stages.
   *
   *   `LineFramer` frames — and bounds nothing, so a run that overruns its
   *   output budget still reaches its own terminal.
   *   `PiStreamDecoder` decodes the CLI's `--mode json` vocabulary.
   *   `EventSequencer` sequences, bounds, and settles.
   *
   * This method owns only what is left over from those three: the loop, and the
   * question of what an ended stream MEANT.
   */
  async *parse(
    transport: ProcessTransport,
    signal?: AbortSignal,
    options: PiParseOptions = {},
  ): AsyncIterable<NormalizedEvent> {
    const framer = new LineFramer();
    const sequencer = new EventSequencer({
      runId: transport.runId,
      now: this.#now,
      budget: new OutputBudget(this.#limits),
    });
    const decoder = new PiStreamDecoder({
      adapter: this.id,
      provider: PI_PROVIDER,
      requestedModel: options.requestedModel ?? "unknown-model",
      now: this.#now,
      ...(options.session === undefined ? {} : { session: options.session }),
      ...(options.images === undefined ? {} : { images: options.images }),
    });

    // Started BEFORE the first byte is read, and never stopped. A child that
    // blocks writing to a full stderr pipe never reaches the part where it
    // writes its result.
    const stderr = drainStderr(transport);
    /** The decoder's terminal, held back so the exit code can be measured. */
    let held: NormalizedEvent | null = null;

    try {
      for await (const chunk of transport.stdout) {
        for (const line of framer.push(chunk)) {
          for (const event of decoder.decode(line, sequencer)) {
            if (isTerminalKind(event.kind)) held = event;
            else yield event;
          }
        }
      }
      // Abrupt EOF: the tail a provider died in the middle of writing is
      // released as a line, and stays visible as a malformed one.
      for (const line of framer.flush()) {
        for (const event of decoder.decode(line, sequencer)) {
          if (isTerminalKind(event.kind)) held = event;
          else yield event;
        }
      }
    } catch (error) {
      // The stream itself failed. A run whose bytes stopped arriving still owes
      // exactly one terminal, and a settlement for every tool call it left open.
      await stderr.done;
      // The run may ALREADY have settled — the provider printed its terminal
      // and the pipe broke on the way out. Holding the terminal to measure the
      // exit code made that case lose it entirely: the sequencer is terminal,
      // so `cancel`/`fail` below return nothing, and the run reached a consumer
      // with no terminal event at all. Whatever else happens, a decoded
      // terminal is yielded.
      if (held !== null) {
        yield* this.#settleHeld(transport, held);
        return;
      }
      yield* decoder.ensureStarted(sequencer);
      yield* isCancellation(error) || signal?.aborted === true
        ? sequencer.cancel(cancellationReason(signal, error))
        : sequencer.fail(
            "E_BACKEND_FAILURE",
            `the provider's output stream failed: ${describe(error)}${stderrSuffix(stderr)}`,
          );
      return;
    }

    await stderr.done;
    if (held !== null) {
      yield* this.#settleHeld(transport, held);
      return;
    }

    // Nothing decoded a terminal. The run still owes an opening — a process
    // that wrote nothing at all to stdout and died with its reason on stderr
    // never reached `decode`, and a `run.failed` with no `run.started` in front
    // of it is a run the trace cannot describe.
    yield* decoder.ensureStarted(sequencer);
    // A killed process group closes its pipes cleanly, so a cancelled run and a
    // provider that simply stopped talking look identical from here. The signal
    // is the only thing that can tell them apart, and it is the host's own.
    if (signal?.aborted === true) {
      yield* sequencer.cancel(cancellationReason(signal, null));
      return;
    }
    yield* sequencer.fail(
      "E_TERMINAL_MISSING",
      `the provider's stream ended without a terminal event${stderrSuffix(stderr)}`,
    );
  }
}

/** What the run was cancelled for: the caller's own reason wherever there is one. */
function cancellationReason(signal: AbortSignal | undefined, error: unknown): string {
  const reason = signal?.aborted === true ? describe(signal.reason) : describe(error);
  return `the provider's output stream was cancelled: ${reason}`;
}

/**
 * Whether a stream failure was a cancellation rather than a fault.
 *
 * Anything unrecognized is a failure: calling an unknown fault a cancellation
 * would let a real defect arrive as an intentional stop.
 */
function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    error.name === "AbortError" || code === "ABORT_ERR" || code === "ERR_STREAM_PREMATURE_CLOSE"
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

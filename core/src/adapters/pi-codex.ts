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

import {
  AdapterError,
  type Availability,
  type HarnessAdapter,
  type ModelInfo,
  type ModelRequest,
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

function thinkingFor(level: string): PiThinking {
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

export class PiCodexAdapter implements HarnessAdapter {
  readonly id = PI_ADAPTER_ID;
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
   * `continuity: "none"` is the second correction, and it is a promise being
   * withdrawn rather than a capability being lost. This adapter pins
   * `--no-session`, which forecloses `--continue`/`--resume`, and
   * `ProcessSpec.stdin` is one string written once — so there is no way to
   * re-enter a session, and a correction through this adapter is necessarily a
   * cold start. Declaring otherwise would have told M5's escalation ladder that
   * a correction here costs tokens rather than a tier call, which is a pricing
   * decision made on a capability that does not exist. `assertSameSession` and
   * the session record stay: they are what a correction transport will need on
   * the day one is built, and they are what makes this value re-earnable.
   *
   * `contextWindow: null` means this adapter declares no ceiling — not that the
   * ceiling is zero. pi's local model store knows the real number; reading it
   * would make this adapter depend on the CLI's private state, and the catalog
   * that owns the number is T15's.
   */
  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id,
      provider: PI_PROVIDER,
      requestedModel: selectorFor(model),
      contextWindow: null,
      supportsThinking: true,
      supportsTools: true,
      supportsImages: true,
      continuity: "none",
      usageAuthority: "provider",
      costAuthority: "catalog-estimate",
    };
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
      "--no-session",
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
  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: AbortSignal,
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
    yield* this.parse(transport, signal, { requestedModel: selectorFor(request.model) });
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

// The Claude Code adapter: Claude Pro as a first-class worker route, through
// its own CLI, with the prompt on stdin and the model identity taken from the
// stream rather than from the argv that asked for it.
//
// Two halves, and the split is the discipline:
//
//   `buildSpec` is PURE. It is asserted down to exact argv without any child
//   ever starting, which is what makes "the prompt never rides argv" a
//   descriptor test rather than a code review. The flag list is pinned to
//   `specs/awsf-plan.html` § "The five adapters and their real flags" and was
//   reconciled against `claude --help` on 2.1.224.
//
//   `parse` turns the CLI's `stream-json` output into the twelve normalized
//   event kinds. Every run-level invariant — one terminal, explicit tool
//   settlement, host-minted tool ids, `null ≠ 0`, fail-closed identity — belongs
//   to `EventSequencer`, so this file's whole contribution is decoding one
//   provider's line vocabulary.
//
// ---------------------------------------------------------------------------
// Two provider facts this adapter deliberately does NOT carry:
//
//   · `result.total_cost_usd` is an API-list-price estimate. What a Claude Pro
//     run actually cost is a share of a subscription, which is not a number the
//     provider can report — so `costAuthority` is `"unavailable"` and the UI
//     renders `— subscription`, never `$0.00` and never that estimate wearing a
//     price's clothes. See `cost-display.ts`.
//   · Provider tool ids (`toolu_…`) are Map keys here and reach no event; the
//     host mints `t1, t2, …`.
// ---------------------------------------------------------------------------

import {
  AdapterError,
  type Availability,
  type HarnessAdapter,
  type ModelInfo,
  type ModelRequest,
  type ProcessRegistration,
  type ProcessSpec,
  type ProcessTransport,
  type TransportBroker,
} from "./interface.ts";
import { filterEnv } from "./env.ts";
import { assertPrivateSystemPrompt } from "./system-prompt-file.ts";
import { ClaudeStreamDecoder, type ClaudeSessionRecord } from "./claude-code-stream.ts";
import type { NormalizedEvent } from "../contracts/normalized-events.ts";
import type { UnionOf } from "../contracts/typebox.ts";
import { LineFramer } from "./stream/line-framer.ts";
import { EventSequencer } from "./stream/event-sequencer.ts";
import { OutputBudget, type OutputBudgetOptions } from "./stream/output-budget.ts";

export { writeSystemPromptFile } from "./system-prompt-file.ts";
export type { ClaudeSessionRecord } from "./claude-code-stream.ts";

export const CLAUDE_ADAPTER_ID = "claude-code";

/** The vendor behind the route. Distinct from the adapter, which is the CLI. */
export const CLAUDE_PROVIDER = "anthropic";

/**
 * Model selectors arrive as `claude:opus` from `awsf.config.yaml` § agents and
 * as `opus` from anything that already resolved the route.
 */
export const CLAUDE_MODEL_PREFIX = "claude:";

/**
 * Leading alphanumeric, then the punctuation real Claude selectors use —
 * `opus`, `sonnet`, `claude-fable-5`. Anything else is a selector the harness
 * cannot represent, and it fails closed rather than reaching argv.
 */
const SAFE_MODEL_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `--effort` levels the CLI accepts (`claude --help`, 2.1.224). */
export const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ClaudeEffort = UnionOf<typeof CLAUDE_EFFORT_LEVELS>;

/**
 * `awsf.config.yaml` § agents declares `thinking: none`, and the CLI has no
 * off switch. `low` is the honest floor: omitting `--effort` would inherit
 * whatever the CLI's default is today, and a default that widens in a future
 * release would silently widen the ceiling — the same reasoning as the deny
 * list below.
 */
const EFFORT_ALIASES: Readonly<Record<string, ClaudeEffort>> = Object.freeze({
  none: "low",
  off: "low",
  minimal: "low",
});

/**
 * Read-only profiles pass an EXPLICIT deny list rather than trusting the
 * default (`launch.ts:66-76`). A default that widens in a future release
 * silently widens our ceiling, and nothing would fail to tell us.
 */
export const MUTATING_OR_SHELL_TOOLS: readonly string[] = Object.freeze([
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
]);

/** The profile vocabulary of `awsf.config.yaml` § `agents[].tools.profile`. */
export const CLAUDE_TOOL_PROFILES = ["readonly", "managed-worker", "no-tools"] as const;
export type ClaudeToolProfile = UnionOf<typeof CLAUDE_TOOL_PROFILES>;

/** The default when a caller states no profile: the narrowest one that exists. */
export const DEFAULT_TOOL_PROFILE: ClaudeToolProfile = "readonly";

/**
 * Gate commands are host-run subprocesses, never provider tool calls. A request
 * that asks this adapter to execute a gate is asking it to enforce a ceiling it
 * has no way to enforce, so it refuses instead of approximating.
 */
const HOST_ONLY_PROFILE = "gate-execute";

function permissionArgs(adapter: string, profile: string): readonly string[] {
  if (profile === HOST_ONLY_PROFILE) {
    throw new AdapterError(
      adapter,
      "E_POLICY_CEILING_UNENFORCEABLE",
      "gate execution is host-only; no provider profile can enforce it",
    );
  }
  switch (profile) {
    case "no-tools":
      return ["--permission-mode", "dontAsk", "--tools", ""];
    case "managed-worker":
      return ["--permission-mode", "acceptEdits", "--tools", "Read,Glob,Grep,Bash,Edit,Write"];
    case "readonly":
      return [
        "--permission-mode",
        "dontAsk",
        "--tools",
        "Read,Glob,Grep",
        "--disallowed-tools",
        MUTATING_OR_SHELL_TOOLS.join(","),
      ];
    default:
      throw new AdapterError(
        adapter,
        "E_INVALID_REQUEST",
        `no tool profile named ${JSON.stringify(profile)}; this adapter knows ` +
          `${CLAUDE_TOOL_PROFILES.join(", ")}`,
      );
  }
}

/** `claude:opus` and `opus` are the same route; anything unrepresentable fails closed. */
export function selectorFor(model: string): string {
  const name = model.startsWith(CLAUDE_MODEL_PREFIX)
    ? model.slice(CLAUDE_MODEL_PREFIX.length)
    : model;
  if (!SAFE_MODEL_SELECTOR.test(name)) {
    throw new AdapterError(
      CLAUDE_ADAPTER_ID,
      "E_MODEL_UNRESOLVED",
      `${JSON.stringify(model)} is not a model selector this adapter can put on a command line`,
    );
  }
  return name;
}

function effortFor(effort: string): ClaudeEffort {
  const level = EFFORT_ALIASES[effort] ?? effort;
  if (!(CLAUDE_EFFORT_LEVELS as readonly string[]).includes(level)) {
    throw new AdapterError(
      CLAUDE_ADAPTER_ID,
      "E_INVALID_REQUEST",
      `no effort level named ${JSON.stringify(effort)}; the CLI accepts ` +
        `${CLAUDE_EFFORT_LEVELS.join(", ")}`,
    );
  }
  return level as ClaudeEffort;
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
 * No new error code was invented for it. A different model is exactly
 * `E_MODEL_MISMATCH`, which the sequencer already raises for the same fact
 * arriving mid-run; a different session is a transport-level failure of the
 * continuity the adapter promised, which is `E_BACKEND_FAILURE`.
 */
export function assertSameSession(first: ClaudeSessionRecord, next: ClaudeSessionRecord): void {
  if (first.resolvedModel !== next.resolvedModel) {
    throw new AdapterError(
      CLAUDE_ADAPTER_ID,
      "E_MODEL_MISMATCH",
      `the correction answered on ${JSON.stringify(next.resolvedModel)} but the phase ` +
        `began on ${JSON.stringify(first.resolvedModel)}; a phase answers on one model`,
    );
  }
  if (first.sessionId === null || next.sessionId === null || first.sessionId !== next.sessionId) {
    throw new AdapterError(
      CLAUDE_ADAPTER_ID,
      "E_BACKEND_FAILURE",
      `the correction ran in provider session ${JSON.stringify(next.sessionId)} rather than ` +
        `${JSON.stringify(first.sessionId)}; a correction re-enters the session it corrects`,
    );
  }
}

export interface ClaudeParseOptions {
  /** What the host ASKED for. The stream says what answered; the two are different facts. */
  requestedModel?: string;
  /** Filled in as the stream names the session and the model. */
  session?: ClaudeSessionRecord;
}

export interface ClaudeCodeAdapterOptions {
  /** The executable NAME; the broker resolves it against PATH. */
  executable?: string;
  /** Host observation time. Injected so a replayed transcript is byte-stable. */
  now?: () => string;
  limits?: OutputBudgetOptions;
}

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly id = CLAUDE_ADAPTER_ID;
  readonly #executable: string;
  readonly #now: () => string;
  readonly #limits: OutputBudgetOptions;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.#executable = options.executable ?? "claude";
    this.#now = options.now ?? ((): string => new Date().toISOString());
    this.#limits = options.limits ?? {};
  }

  /**
   * Available if the executable is a name the broker can resolve.
   *
   * Deliberately does NOT run `claude --version`: an availability check that
   * spawns is a provider process the host never registered, and this adapter is
   * not allowed to start one. Whether the binary actually exists is the
   * broker's answer to give, at launch, where a failure is already a run.
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
   * `usageAuthority: "provider"` and `costAuthority: "unavailable"` are separate
   * statements and both are true: the CLI reports token counts it measured, and
   * cannot report what a subscription run cost. Collapsing the two would make a
   * Claude Pro route look free rather than unpriced.
   *
   * `contextWindow: null` means this adapter declares no ceiling — not that the
   * ceiling is zero. The catalog that knows the real number is T15's.
   */
  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id,
      provider: CLAUDE_PROVIDER,
      requestedModel: selectorFor(model),
      contextWindow: null,
      supportsThinking: true,
      supportsTools: true,
      supportsImages: true,
      continuity: "same-session-correction",
      usageAuthority: "provider",
      costAuthority: "unavailable",
    };
  }

  /**
   * PURE. Spawns nothing, reads nothing, and is asserted down to exact argv.
   *
   * The flag ORDER is part of the assertion, not an accident of construction: a
   * descriptor test that accepted any permutation would accept an argv nobody
   * reviewed, and this list is the reviewed one.
   */
  buildSpec(request: ModelRequest): ProcessSpec {
    const argv: string[] = [
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--model",
      selectorFor(request.model),
      "--no-session-persistence",
    ];
    if (request.effort !== undefined) argv.push("--effort", effortFor(request.effort));
    if (request.systemPromptPath !== undefined) {
      argv.push("--append-system-prompt-file", request.systemPromptPath);
    }
    argv.push(...permissionArgs(this.id, request.profile ?? DEFAULT_TOOL_PROFILE));
    return {
      executable: this.#executable,
      argv: Object.freeze(argv),
      cwd: request.cwd,
      env: filterEnv(this.id, request.env),
      // The prompt. NEVER argv — see the header.
      stdin: request.prompt,
      shell: false,
    };
  }

  /**
   * Describe, hand to the broker, parse. The adapter never starts anything
   * itself — and it never starts anything TWICE. There is no retry here, which
   * is what makes "quota is never a retry" structural rather than a policy
   * somebody has to remember: a run that ends `E_QUOTA_EXHAUSTED` ends, and the
   * decision about what happens next belongs to a layer that can see the budget.   */
  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: ProcessRegistration,
    signal: AbortSignal,
  ): AsyncIterable<NormalizedEvent> {
    if (request.systemPromptPath !== undefined) {
      assertPrivateSystemPrompt(this.id, request.systemPromptPath);
    }
    const transport = await broker.startProcess(registration, this.buildSpec(request), signal);
    yield* this.parse(transport, signal, { requestedModel: selectorFor(request.model) });
  }

  /**
   * Bytes to normalized events, through the three stream-layer stages.
   *
   *   `LineFramer` frames — and bounds nothing, so a run that overruns its
   *   output budget still reaches its own terminal.
   *   `ClaudeStreamDecoder` decodes the CLI's `stream-json` vocabulary.
   *   `EventSequencer` sequences, bounds, and settles.
   *
   * This method owns only what is left over from those three: the loop, and the
   * question of what an ended stream MEANT.
   */
  async *parse(
    transport: ProcessTransport,
    signal?: AbortSignal,
    options: ClaudeParseOptions = {},
  ): AsyncIterable<NormalizedEvent> {
    const framer = new LineFramer();
    const sequencer = new EventSequencer({
      runId: transport.runId,
      now: this.#now,
      budget: new OutputBudget(this.#limits),
    });
    const decoder = new ClaudeStreamDecoder({
      adapter: this.id,
      provider: CLAUDE_PROVIDER,
      requestedModel: options.requestedModel ?? "unknown-model",
      ...(options.session === undefined ? {} : { session: options.session }),
    });

    try {
      for await (const chunk of transport.stdout) {
        for (const line of framer.push(chunk)) yield* decoder.decode(line, sequencer);
      }
      // Abrupt EOF: the tail a provider died in the middle of writing is
      // released as a line, and stays visible as a malformed one.
      for (const line of framer.flush()) yield* decoder.decode(line, sequencer);
    } catch (error) {
      // The stream itself failed. A run whose bytes stopped arriving still owes
      // exactly one terminal, and a settlement for every tool call it left open.
      yield* isCancellation(error) || signal?.aborted === true
        ? sequencer.cancel(cancellationReason(signal, error))
        : sequencer.fail("E_BACKEND_FAILURE", `the provider's output stream failed: ${describe(error)}`);
      return;
    }

    // A killed process group closes its pipes cleanly, so a cancelled run and a
    // provider that simply stopped talking look identical from here. The signal
    // is the only thing that can tell them apart, and it is the host's own.
    if (sequencer.terminal === null && signal?.aborted === true) {
      yield* sequencer.cancel(cancellationReason(signal, null));
      return;
    }
    yield* sequencer.finish();
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

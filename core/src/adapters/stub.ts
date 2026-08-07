// The stub adapter: a real provider process with no provider behind it.
//
// Every phase, gate, workflow and journey test in the plan runs on this, which
// is why M1-M3 and all of M5's journeys cost zero quota. It is scriptable
// because the interesting cases are the ugly ones — a provider that never
// speaks, one that speaks forever, one that emits half a JSON object, one that
// spawns a child the host never saw.
//
// `providerPath` is a REQUIRED option with no default. The executable it names
// lives under `core/test/fixtures/providers/stub/`, and `core/src` does not
// reach into the test tree to find it: the caller that owns the fixture is the
// caller that supplies the path. (The executable is a fixture because the
// `grandchild-spawner` script has to spawn, and `node:child_process` is
// importable nowhere in `core/src` except `execution/transport-broker.ts`.)
//
// `buildSpec` is PURE. The descriptor tests below it assert exact argv without
// any child ever starting, and the prompt appears in `stdin` and nowhere else.

import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
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
import type { NormalizedEvent } from "../contracts/normalized-events.ts";
import type { UnionOf } from "../contracts/typebox.ts";
import { LineFramer } from "./stream/line-framer.ts";
import { EventSequencer } from "./stream/event-sequencer.ts";
import { OutputBudget, type OutputBudgetOptions } from "./stream/output-budget.ts";

/**
 * The eight behaviours. Each is a real failure mode of a real provider:
 *
 * - `success` / `model-line` / `no-model-line` — a clean run, one that names
 *   its resolved model authoritatively, and one that never does (which must
 *   fail closed rather than resolve to the requested name).
 * - `timeout` — noisy and endless. Trips a hard timeout and must NOT trip the
 *   silence window; the two monitors are different and this proves it.
 * - `silence` — silent and endless. Trips the silence window.
 * - `overload` — a transport-class provider error.
 * - `malformed` — a truncated JSON object and a bare line.
 * - `grandchild-spawner` — spawns a child in the same process group, so
 *   cancellation has something to reap that the host never saw.
 */
export const STUB_SCRIPTS = [
  "success",
  "timeout",
  "silence",
  "overload",
  "malformed",
  "model-line",
  "no-model-line",
  "grandchild-spawner",
] as const;
export type StubScript = UnionOf<typeof STUB_SCRIPTS>;

/** Models are named `stub/<script>`: the script IS the model, which is what makes it scriptable. */
export const STUB_MODEL_PREFIX = "stub/";

export function scriptFor(model: string): StubScript {
  const name = model.startsWith(STUB_MODEL_PREFIX) ? model.slice(STUB_MODEL_PREFIX.length) : model;
  if (!(STUB_SCRIPTS as readonly string[]).includes(name)) {
    // A model the harness cannot represent does not silently resolve to
    // something near it. It fails closed, here, before a spec exists.
    throw new AdapterError(
      "stub",
      "E_MODEL_UNRESOLVED",
      `no script named ${JSON.stringify(name)}; the stub knows ${STUB_SCRIPTS.join(", ")}`,
    );
  }
  return name as StubScript;
}

export interface StubAdapterOptions {
  /** Absolute path to the stub provider executable. No default — see the header. */
  providerPath: string;
  /**
   * Where the provider writes proof that it ran. The kill-host simulation
   * asserts this file does NOT exist, so it must be written by the provider and
   * by nothing else.
   */
  sideEffectPath: string;
  /** Host observation time. Injected so a replayed transcript is byte-stable. */
  now?: () => string;
  /**
   * The output budget this adapter's runs are held to. Defaults to
   * `awsf.config.yaml` § runtime; the suites shrink it to prove that framing
   * still reads past it and that terminals still arrive.
   */
  limits?: OutputBudgetOptions;
}

// ---------------------------------------------------------------------------
// The stub's wire format.
// ---------------------------------------------------------------------------

interface StubLine {
  type: string;
  script?: string;
  model?: string;
  text?: string;
  kind?: string;
  message?: string;
  exitCode?: number;
  pid?: number;
}

/** What the run carries forward across lines. The host remembers what it asked for. */
interface ParseContext {
  requestedModel: string;
}

export class StubAdapter implements HarnessAdapter {
  readonly id = "stub";
  readonly #providerPath: string;
  readonly #sideEffectPath: string;
  readonly #now: () => string;
  readonly #limits: OutputBudgetOptions;

  constructor(options: StubAdapterOptions) {
    this.#providerPath = options.providerPath;
    this.#sideEffectPath = options.sideEffectPath;
    this.#now = options.now ?? ((): string => new Date().toISOString());
    this.#limits = options.limits ?? {};
  }

  async isAvailable(): Promise<Availability> {
    if (!isAbsolute(this.#providerPath)) {
      return { status: "blocked", code: "E_INVALID_REQUEST", detail: "providerPath must be absolute" };
    }
    try {
      accessSync(this.#providerPath, constants.X_OK);
      return { status: "available" };
    } catch (error) {
      return {
        status: "blocked",
        code: "E_INVALID_REQUEST",
        detail: `${this.#providerPath} is not executable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * The stub reports no usage and no cost, and says so rather than reporting
   * zeros. `null ≠ 0` is the same rule here as it is on a real provider: a
   * fixture that claimed to have measured zero tokens would be data, and it
   * would be false.
   */
  async getModelInfo(model: string): Promise<ModelInfo> {
    const script = scriptFor(model);
    return {
      adapter: this.id,
      provider: "stub",
      requestedModel: `${STUB_MODEL_PREFIX}${script}`,
      contextWindow: null,
      supportsThinking: false,
      supportsTools: false,
      supportsImages: false,
      continuity: "none",
      usageAuthority: "none",
      costAuthority: "unavailable",
    };
  }

  /** PURE. Spawns nothing, reads nothing, and is asserted down to exact argv. */
  buildSpec(request: ModelRequest): ProcessSpec {
    return {
      executable: this.#providerPath,
      argv: [scriptFor(request.model), this.#sideEffectPath],
      cwd: request.cwd,
      env: request.env,
      stdin: request.prompt,
      shell: false,
    };
  }

  /**
   * Bytes to normalized events, through the three stream-layer stages.
   *
   *   `LineFramer` frames — and bounds nothing, so a run that overruns its
   *   output budget still reaches its own terminal.
   *   this method decodes the stub's line vocabulary.
   *   `EventSequencer` sequences, bounds, and settles.
   *
   * The stub's own contribution is the middle stage and nothing else: every
   * invariant that holds over the run — one terminal, explicit tool settlement,
   * host-minted ids, `null ≠ 0`, fail-closed model identity — belongs to the
   * sequencer, so no adapter can get one of them subtly wrong on its own.
   */
  async *parse(transport: ProcessTransport, signal?: AbortSignal): AsyncIterable<NormalizedEvent> {
    const framer = new LineFramer();
    const sequencer = new EventSequencer({
      runId: transport.runId,
      now: this.#now,
      budget: new OutputBudget(this.#limits),
    });
    // The requested model is carried forward from `run.started` rather than
    // re-read per line: a real provider names the model it RESOLVED, and the
    // host is the one that remembers what it asked for.
    const context: ParseContext = { requestedModel: `${STUB_MODEL_PREFIX}unknown` };

    try {
      for await (const chunk of transport.stdout) {
        for (const line of framer.push(chunk)) yield* this.#line(line, sequencer, context);
      }
      // Abrupt EOF: the tail a provider died in the middle of writing is
      // released as a line, and stays visible as a malformed one.
      for (const line of framer.flush()) yield* this.#line(line, sequencer, context);
    } catch (error) {
      // The stream itself failed. A run whose bytes stopped arriving still owes
      // exactly one terminal, and it still owes a settlement for every tool call
      // it left open — which is what makes cancellation legible rather than a
      // stream that simply stops.
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

  #line(line: string, sequencer: EventSequencer, context: ParseContext): readonly NormalizedEvent[] {
    const text = line.trim();
    if (text.length === 0) return [];
    let parsed: StubLine;
    try {
      parsed = JSON.parse(text) as StubLine;
    } catch {
      // Never silently discarded: a line the host could not read is a fact
      // about the run, and the trace has to carry it.
      return sequencer.notice(
        "non-json-output",
        "the stub emitted a line that is not JSON",
        text.slice(0, 200),
      );
    }
    switch (parsed.type) {
      case "started":
        context.requestedModel = `${STUB_MODEL_PREFIX}${parsed.script ?? "unknown"}`;
        return sequencer.started({ adapter: this.id, requestedModel: context.requestedModel });
      case "model":
        return sequencer.resolveModel({
          adapter: this.id,
          provider: "stub",
          requestedModel: context.requestedModel,
          // No fallback: a `model` line that names nothing is an identity the
          // harness cannot represent, and it fails closed rather than resolving
          // to a placeholder that would render as a confirmed answer.
          resolvedModel: parsed.model ?? "",
          // The provider named it in its own stream. Nothing was inferred.
          provenance: "stream-authoritative",
        });
      case "text":
        return sequencer.text("text.delta", parsed.text ?? "");
      case "error":
        return sequencer.fail(
          "E_BACKEND_FAILURE",
          `${parsed.kind ?? "error"}: ${parsed.message ?? "the stub provider failed"}`,
        );
      case "result":
        return sequencer.complete(parsed.exitCode ?? 0);
      default:
        return sequencer.notice(
          "unknown-provider-event",
          `the stub emitted an unrecognized line type ${JSON.stringify(parsed.type)}`,
          text.slice(0, 200),
        );
    }
  }

  /** Describe, hand to the broker, parse. The adapter never starts anything itself. */
  async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: ProcessRegistration,
    signal: AbortSignal,
  ): AsyncIterable<NormalizedEvent> {
    const transport = await broker.startProcess(registration, this.buildSpec(request), signal);
    yield* this.parse(transport, signal);
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
 * A cancelled run and a broken one produce different terminals and mean
 * different things to the lifecycle, so the distinction is made on the error's
 * own code rather than on the fact that reading stopped. Anything unrecognized
 * is a failure: calling an unknown fault a cancellation would let a real defect
 * arrive as an intentional stop.
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

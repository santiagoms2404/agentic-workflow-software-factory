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

/**
 * An event minus the four fields the host stamps on every one of them.
 *
 * Mapped over the kinds rather than written as `Omit<NormalizedEvent, …>`:
 * omitting from a union collapses it to the fields the members share, which
 * would make `errorCode`, `exitCode` and the rest unassignable. This keeps each
 * kind's own payload checked.
 */
type EventBody = {
  [K in NormalizedEvent["kind"]]: Omit<
    Extract<NormalizedEvent, { kind: K }>,
    "seq" | "runId" | "hostAt" | "providerAt"
  >;
}[NormalizedEvent["kind"]];

export class StubAdapter implements HarnessAdapter {
  readonly id = "stub";
  readonly #providerPath: string;
  readonly #sideEffectPath: string;
  readonly #now: () => string;

  constructor(options: StubAdapterOptions) {
    this.#providerPath = options.providerPath;
    this.#sideEffectPath = options.sideEffectPath;
    this.#now = options.now ?? ((): string => new Date().toISOString());
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
   * Bytes to normalized events.
   *
   * The framing here is deliberately minimal: T12's `LineFramer` owns
   * code-point-safe chunk boundaries and per-instance decoders, and its
   * `EventSequencer` owns the sequence invariants. What this does is map the
   * stub's own line vocabulary onto the twelve kinds so the barrier work has a
   * real event stream to prove itself against.
   */
  async *parse(transport: ProcessTransport): AsyncIterable<NormalizedEvent> {
    const runId = transport.runId;
    let seq = 0;
    let terminal = false;
    // `seq` is authoritative and host-minted; `providerAt` is null because the
    // stub has no clock of its own to be advisory about. The one cast is here
    // rather than at each call site: spreading a union into a literal is
    // something the compiler cannot follow, and eight casts would be eight
    // places for a real mistake to hide.
    const next = (body: EventBody): NormalizedEvent => {
      seq += 1;
      return { ...body, seq, runId, hostAt: this.#now(), providerAt: null } as NormalizedEvent;
    };

    // The requested model is carried forward from `run.started` rather than
    // re-read per line: a real provider names the model it RESOLVED, and the
    // host is the one that remembers what it asked for.
    const context = { requestedModel: `${STUB_MODEL_PREFIX}unknown` };
    let pending = "";
    const decoder = new TextDecoder("utf8");
    for await (const chunk of transport.stdout) {
      pending += decoder.decode(chunk, { stream: true });
      let index = pending.indexOf("\n");
      while (index >= 0) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        index = pending.indexOf("\n");
        const event = this.#lineToEvent(line, next, context);
        if (event === null) continue;
        if (event.kind === "run.completed" || event.kind === "run.failed") terminal = true;
        yield event;
      }
    }
    if (pending.trim().length > 0) {
      const event = this.#lineToEvent(pending, next, context);
      if (event !== null) {
        if (event.kind === "run.completed" || event.kind === "run.failed") terminal = true;
        yield event;
      }
    }

    // Exactly one terminal per run. A stream that simply stopped did not
    // succeed quietly — it failed, and it says which way.
    if (!terminal) {
      yield next({
        kind: "run.failed",
        errorCode: "E_TERMINAL_MISSING",
        message: "the stub provider's stream ended without a terminal line",
      });
    }
  }

  #lineToEvent(
    line: string,
    next: (body: EventBody) => NormalizedEvent,
    context: { requestedModel: string },
  ): NormalizedEvent | null {
    const text = line.trim();
    if (text.length === 0) return null;
    let parsed: StubLine;
    try {
      parsed = JSON.parse(text) as StubLine;
    } catch {
      // Never silently discarded: a line the host could not read is a fact
      // about the run, and the trace has to carry it.
      return next({
        kind: "notice",
        code: "non-json-output",
        message: "the stub emitted a line that is not JSON",
        detail: text.slice(0, 200),
      });
    }
    switch (parsed.type) {
      case "started":
        context.requestedModel = `${STUB_MODEL_PREFIX}${parsed.script ?? "unknown"}`;
        return next({
          kind: "run.started",
          adapter: this.id,
          requestedModel: context.requestedModel,
        });
      case "model":
        return next({
          kind: "model.resolved",
          adapter: this.id,
          provider: "stub",
          requestedModel: context.requestedModel,
          resolvedModel: parsed.model ?? "unknown",
          // The provider named it in its own stream. Nothing was inferred.
          provenance: "stream-authoritative",
        });
      case "text":
        return next({ kind: "text.delta", text: parsed.text ?? "" });
      case "error":
        return next({
          kind: "run.failed",
          errorCode: "E_BACKEND_FAILURE",
          message: `${parsed.kind ?? "error"}: ${parsed.message ?? "the stub provider failed"}`,
        });
      case "result":
        return next({ kind: "run.completed", exitCode: parsed.exitCode ?? 0 });
      default:
        return next({
          kind: "notice",
          code: "unknown-provider-event",
          message: `the stub emitted an unrecognized line type ${JSON.stringify(parsed.type)}`,
          detail: text.slice(0, 200),
        });
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
    yield* this.parse(transport);
  }
}

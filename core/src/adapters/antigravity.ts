// Antigravity is deliberately a probe, not an untested parser.
//
// Verification procedure (the only way this file may graduate): run ONE
// bounded `agy` session with a small read-only prompt; capture its raw stdout
// and stderr without editing either; read the captured output; then decide
// whether it exposes a machine-parseable stream and implement it fixture-first.
// Until those observed bytes exist, no argv or parser is safe to invent.

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
import type { NormalizedEvent } from "../contracts/normalized-events.ts";

export const ANTIGRAVITY_ADAPTER_ID = "antigravity";

export class AntigravityAdapter implements HarnessAdapter {
  readonly id = ANTIGRAVITY_ADAPTER_ID;

  async isAvailable(_signal?: AbortSignal): Promise<Availability> {
    return {
      status: "blocked",
      code: "E_ADAPTER_UNVERIFIED",
      detail: "agy has no captured, reviewed machine-parseable stream; see antigravity.ts verification procedure",
    };
  }

  async getModelInfo(model: string): Promise<ModelInfo> {
    return {
      adapter: this.id,
      provider: "google",
      requestedModel: model,
      contextWindow: null,
      supportsThinking: false,
      supportsTools: false,
      supportsImages: false,
      continuity: "none",
      usageAuthority: "none",
      costAuthority: "unavailable",
    };
  }

  buildSpec(_request: ModelRequest): ProcessSpec {
    throw this.#unverified();
  }

  async *parse(_transport: ProcessTransport, _signal?: AbortSignal): AsyncIterable<NormalizedEvent> {
    // Keep this an AsyncIterable for the shared interface; it never reaches a
    // transport because the refusal occurs before launch.
    yield* [] as NormalizedEvent[];
    throw this.#unverified();
  }

  async *execute(
    _request: ModelRequest,
    _broker: TransportBroker,
    _registration: BrokerProcessRegistration,
    _signal: AbortSignal,
  ): AsyncIterable<NormalizedEvent> {
    yield* [] as NormalizedEvent[];
    throw this.#unverified();
  }

  #unverified(): AdapterError {
    return new AdapterError(
      this.id,
      "E_ADAPTER_UNVERIFIED",
      "agy is disabled until one bounded session is captured, read, and shown machine-parseable",
    );
  }
}

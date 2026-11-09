import type { RunErrorCode } from "./normalized-events.ts";

/**
 * An adapter refusal, carrying one of the eleven error codes the contract
 * names. The code is the vocabulary the UI and the journal share, so an adapter
 * that fails for a reason outside it has to widen the list rather than invent a
 * private one.
 */
export class AdapterError extends Error {
  readonly code: RunErrorCode;
  readonly adapter: string;

  constructor(adapter: string, code: RunErrorCode, message: string) {
    super(`${adapter}: ${message} (${code})`);
    this.name = "AdapterError";
    this.code = code;
    this.adapter = adapter;
  }
}

import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import type { ParseEnvelopeResult } from "../contracts/parse-envelope.ts";
import { GateReport } from "./interface.ts";

/** Requires both structural validity and an explicit successful producer result. */
export function envelopeValid(result: ParseEnvelopeResult<EnvelopeBase>): GateReport {
  const report = new GateReport("envelope_valid");
  report.check(
    "schema parses",
    result.valid,
    result.valid ? `valid ${result.payload.schema}` : `${result.violations.length} schema violation(s)`,
  );
  const status = result.valid ? result.payload.producerStatus : null;
  report.check(
    'producerStatus === "success"',
    status === "success",
    status === null ? "producer status unavailable because the envelope is invalid" : `producerStatus=${status}`,
  );
  return report;
}

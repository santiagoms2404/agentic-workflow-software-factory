import type { DoctorReport } from "../cli/commands/doctor.ts";
import { withJevRow } from "../cli/commands/doctor.ts";
import { assertDoctorReadout, DOCTOR_READOUT_SCHEMA_ID, type DoctorReadout } from "../contracts/doctor-readout.ts";
import type { JevDoctorRow } from "../decision/jev-doctor.ts";
import { scrubCredentials } from "../policy/redaction.ts";
import type { EnvironmentRows } from "./gather.ts";

/** Existing lines and Jev keep their meanings; warnings do not change exit. */
export function buildDoctorReport(existing: DoctorReport, jev: JevDoctorRow, rows: EnvironmentRows): DoctorReadout {
  const report = withJevRow(existing, jev);
  const lines = [...report.lines];
  const summary = lines.findIndex(line => line.startsWith("matrix: "));
  const added = Object.entries(rows).flatMap(([name, row]) => row.detail.map(detail => `${name}: ${row.status}: ${detail}`));
  lines.splice(summary === -1 ? lines.length : summary, 0, ...added);
  const healthy = report.healthy && Object.values(rows).every(row => row.status !== "finding");
  if (!healthy) {
    for (let index = lines.length - 1; index >= 0; index--) if (lines[index]!.startsWith("healthy: ")) lines.splice(index, 1);
    for (const [name, row] of Object.entries(rows)) if (row.status === "finding") lines.push(`finding: ${name}`);
  }
  const model: DoctorReadout = scrubCredentials({ schema: DOCTOR_READOUT_SCHEMA_ID, healthy,
    rows: { existing: { status: existing.healthy ? "ok" : "finding", detail: [...existing.lines] },
      jev: { status: jev.finding === null ? "ok" : "finding", detail: [jev.line] }, ...rows }, lines });
  assertDoctorReadout(model);
  return model;
}

export const GATE_IDS = [
  "envelope_valid",
  "artifacts_exist",
  "files_non_empty",
  "json_parses",
  "diff_matches_claims",
  "head_advanced",
  "candidate_hygiene",
  "no_protected_paths",
  "writes_within_globs",
  "verdict_consistent",
  "commands_pass",
  "journey_passes",
] as const;

export type GateId = (typeof GATE_IDS)[number];

export interface GateCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

/** Evidence emitted by one gate. A passing report still explains every check it performed. */
export class GateReport {
  readonly checks: GateCheck[] = [];
  readonly gateId: GateId;

  constructor(gateId: GateId) {
    this.gateId = gateId;
  }

  check(item: string, ok: boolean, note: string): this {
    this.checks.push(Object.freeze({ item, ok, note }));
    return this;
  }

  get passed(): boolean {
    return this.checks.length > 0 && this.checks.every((check) => check.ok);
  }
}

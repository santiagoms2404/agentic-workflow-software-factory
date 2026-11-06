export const GATE_IDS = [
  "envelope_valid",
  "artifacts_exist",
  "files_non_empty",
  "json_parses",
  "diff_matches_claims",
  "head_advanced",
  "candidate_hygiene",
  "no_protected_paths",
  "risk_tier_sufficient",
  "writes_within_globs",
  "verdict_consistent",
  "review_evidence_present",
  "commands_pass",
  "journey_passes",
  "contract_digest",
  "spine_declared",
  "spine_carried",
  "design_evidence_present",
  "architecture_verdict_consistent",
  "architecture_review_clear",
  "visual_references_inspected",
] as const;

export type GateId = (typeof GATE_IDS)[number];

export type GateKind = "pure" | "filesystem" | "git" | "subprocess" | "journey";

/** One canonical classification for every gate, shared by journal producers and readers. */
export const GATE_KIND_BY_ID: Readonly<Record<GateId, GateKind>> = Object.freeze({
  envelope_valid: "pure",
  artifacts_exist: "filesystem",
  files_non_empty: "filesystem",
  json_parses: "filesystem",
  diff_matches_claims: "git",
  head_advanced: "git",
  candidate_hygiene: "git",
  no_protected_paths: "filesystem",
  risk_tier_sufficient: "pure",
  writes_within_globs: "filesystem",
  verdict_consistent: "pure",
  review_evidence_present: "pure",
  commands_pass: "subprocess",
  journey_passes: "journey",
  contract_digest: "pure",
  spine_declared: "pure",
  spine_carried: "pure",
  design_evidence_present: "pure",
  architecture_verdict_consistent: "pure",
  architecture_review_clear: "pure",
  visual_references_inspected: "pure",
});

export function gateKindFor(gateId: GateId): GateKind {
  return GATE_KIND_BY_ID[gateId];
}

export interface GateCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

/** Evidence emitted by one gate. A passing report still explains every check it performed. */
export class GateReport {
  readonly checks: GateCheck[] = [];
  readonly gateId: GateId;
  readonly passWhenEmpty: boolean;

  constructor(gateId: GateId, options: { readonly passWhenEmpty?: boolean } = {}) {
    this.gateId = gateId;
    this.passWhenEmpty = options.passWhenEmpty ?? false;
  }

  check(item: string, ok: boolean, note: string): this {
    this.checks.push(Object.freeze({ item, ok, note }));
    return this;
  }

  get passed(): boolean {
    return (this.checks.length > 0 || this.passWhenEmpty) && this.checks.every((check) => check.ok);
  }
}

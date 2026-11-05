// What the attempt journal already says about the reviews on record.
//
// Two commands read this and they must read it the same way. `awsf review`
// derives L25's eligibility from it — `reviewEvidenceDefect` is host-determined
// from the recorded gate rows, never asserted by the owner — and `awsf land`
// discloses it, because a landing screen that showed a replacement verdict
// without the verdict it superseded would hide the very thing L25 exists to
// make visible. One reader, so the two can never disagree.
//
// Nothing here decides anything. It reports what was written down.

import { promises as fs } from "node:fs";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { join } from "node:path";
import type { EnvelopeBase } from "../../contracts/envelope-base.ts";
import { isEnvelopeSchemaId, schemaForId } from "../../contracts/registry.ts";
import { REVIEW_OUTPUT_SCHEMA_ID, ReviewOutputSchema, type ReviewOutput } from "../../contracts/review-output.ts";
import { StoredEnvelopeSchema, type EnvelopeExtraction, type StoredEnvelope, type ValidationViolation } from "../../contracts/stored-envelope.ts";
import type { ReviewEvidenceDefect } from "../../state/errors.ts";
import type { GateEvidence, GateEvidenceRow } from "../../state/task-machine.ts";
import type { AttemptEvidence } from "../../observability/attempt-evidence.ts";
import {
  promptSha256,
  type PromptBundle,
} from "../../workflow/prompt-composition.ts";

const { readFile } = fs;

/** The gate id whose recorded row decides whether a review is replaceable at all. */
export const REVIEW_EVIDENCE_GATE_ID = "review_evidence_present";

/**
 * The host gate rows every green-consuming candidate edge requires. The
 * `commands_pass` row aggregates each configured command, so no edge demands
 * per-command rows the host never writes.
 */
export const CANDIDATE_GATE_IDS = Object.freeze(["candidate_hygiene", "commands_pass"] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isEnvelopeExtraction(value: unknown): value is EnvelopeExtraction | null {
  return value === null || value === "exact" || value === "fence-stripped" ||
    value === "outermost-object" || value === "trailing-object";
}

function storedEnvelopeViolations(errors: readonly { path: string; message: string }[]): ValidationViolation[] {
  const selected = errors.slice(0, 64);
  return selected.length === 0
    ? [{ kind: "schema-mismatch", path: "", message: "stored envelope does not satisfy its registered schema", received: null }]
    : selected.map((error) => ({
        kind: "schema-mismatch",
        path: error.path,
        message: error.message.length > 0 ? error.message : "stored envelope does not satisfy its registered schema",
        received: null,
      }));
}

/**
 * Validate registered envelopes as they cross the journal read boundary.
 * Unknown schema ids remain retained exactly as before; a known legacy or
 * malformed record becomes an explicit invalid envelope without rewriting its
 * original journal bytes.
 */
function readEnvelopeEvidence(value: unknown): AttemptEvidence | null {
  if (!isRecord(value) || value.type !== "envelope") return value as AttemptEvidence;
  const rawEnvelope = value.envelope;
  if (!isRecord(rawEnvelope)) return null;
  const schemaId = rawEnvelope.schemaId;
  if (typeof schemaId !== "string" || !isEnvelopeSchemaId(schemaId)) {
    // Unknown envelopes are intentionally retained; this boundary must not
    // turn a future schema into a dropped record or a current-schema verdict.
    return value as AttemptEvidence;
  }

  const payloadSchema = schemaForId(schemaId);
  const storedSchema = StoredEnvelopeSchema(payloadSchema);
  const envelopeCandidate: unknown = rawEnvelope;
  if (Value.Check(storedSchema, envelopeCandidate)) {
    // Every property, including payload, has now passed its current schema.
    return value as AttemptEvidence;
  }

  const envelopeErrors = [...Value.Errors(storedSchema, rawEnvelope)];
  const payloadErrors = rawEnvelope.valid === true
    ? [...Value.Errors(payloadSchema, rawEnvelope.payload)]
    : [];
  const violations = storedEnvelopeViolations(payloadErrors.length > 0 ? payloadErrors : envelopeErrors);
  const phaseId = nonEmptyString(value.phaseId, nonEmptyString(rawEnvelope.phaseId, "unknown-phase"));
  const sessionId = nonEmptyString(rawEnvelope.sessionId, "unknown-session");
  const invalidEnvelope: StoredEnvelope<EnvelopeBase> = {
    envelopeId: nonEmptyString(rawEnvelope.envelopeId, `${sessionId}:${phaseId}:read-validation`),
    sessionId,
    phaseId: nonEmptyString(rawEnvelope.phaseId, phaseId),
    correctionRound: typeof rawEnvelope.correctionRound === "number" &&
      Number.isInteger(rawEnvelope.correctionRound) && rawEnvelope.correctionRound >= 0
      ? rawEnvelope.correctionRound
      : 0,
    agent: nonEmptyString(rawEnvelope.agent, "unknown-agent"),
    schemaId,
    valid: false,
    createdAt: nonEmptyString(rawEnvelope.createdAt, "unknown-time"),
    payload: null,
    violations,
    rawOutputPath: nonEmptyString(rawEnvelope.rawOutputPath, "unknown-output"),
    ...(isEnvelopeExtraction(rawEnvelope.extraction) ? { extraction: rawEnvelope.extraction } : {}),
  };
  // Validate the normalized failure shape too. This keeps read-side legacy
  // handling within the same stored-envelope contract as newly written data.
  if (!Value.Check(StoredEnvelopeSchema(Type.Null()), invalidEnvelope)) return null;
  return { type: "envelope", phaseId, envelope: invalidEnvelope };
}

/**
 * Every evidence record the attempt journal carries, oldest first.
 *
 * Read from the journal rather than from SQLite: the journal is the record of
 * truth, a projection can be degraded or rebuilt, and an eligibility decision
 * that a `awsf db rebuild` could change is not an eligibility decision.
 */
export async function readAttemptEvidence(attemptDir: string): Promise<readonly AttemptEvidence[]> {
  const text = await readFile(join(attemptDir, "journal.jsonl"), "utf8");
  const evidence: AttemptEvidence[] = [];
  const appendLine = (line: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    if (!isRecord(parsed) || !isRecord(parsed.event)) return;
    const carried = parsed.event.evidence;
    if (carried === undefined) return;
    const normalized = readEnvelopeEvidence(carried);
    if (normalized !== null) evidence.push(normalized);
  };
  const lines = text.split("\n");
  // Like scanJournalText, valid journal lines end with a newline so the last element
  // is empty for clean journals; a non-empty last line indicates a torn trailing fragment.
  const complete = lines.slice(0, -1);
  for (const line of complete) {
    if (line.length > 0) appendLine(line);
  }
  const lastLine = lines[lines.length - 1] ?? "";
  if (lastLine.length > 0) appendLine(lastLine);
  return Object.freeze(evidence);
}

export interface RecordedReview {
  /** The `sessions`-scoped phase id the review phase wrote under. */
  readonly phaseId: string;
  /** That phase id's key — `reviewer`, or `reviewer-re<N>` for a replacement. */
  readonly phaseKey: string;
  readonly output: ReviewOutput;
  /**
   * Why this review is not evidence, or `null` when it carries a PASSING
   * `review_evidence_present` row.
   *
   * `null` means the review is not replaceable at all: its verdict stands,
   * whatever it says, and the owner's remedies are the ones the contract
   * already provides. That is the whole of L25's eligibility narrowing, and it
   * is read here from the rows rather than taken from anybody's word for it.
   */
  readonly evidenceDefect: ReviewEvidenceDefect | null;
}

function phaseKeyOf(phaseId: string, sessionId: string): string {
  const prefix = `${sessionId}:`;
  return phaseId.startsWith(prefix) ? phaseId.slice(prefix.length) : phaseId;
}

/**
 * Every recorded review, oldest first, each paired with the evidence defect its
 * own gate rows establish.
 *
 * The subject is the retained ENVELOPE rather than the `review` summary record,
 * because L25's guard needs the findings and only the envelope carries them.
 */
export function recordedReviews(
  evidence: readonly AttemptEvidence[],
  sessionId: string,
): readonly RecordedReview[] {
  const reviews: RecordedReview[] = [];
  const seen = new Set<string>();
  for (const record of evidence) {
    if (record.type !== "envelope") continue;
    const envelope = record.envelope;
    if (envelope.schemaId !== REVIEW_OUTPUT_SCHEMA_ID || !envelope.valid || envelope.payload === null) continue;
    if (!Value.Check(ReviewOutputSchema, envelope.payload)) continue;
    if (seen.has(record.phaseId)) continue;
    seen.add(record.phaseId);
    reviews.push({
      phaseId: record.phaseId,
      phaseKey: phaseKeyOf(record.phaseId, sessionId),
      output: Value.Parse(ReviewOutputSchema, envelope.payload),
      evidenceDefect: evidenceDefectFor(evidence, record.phaseId),
    });
  }
  return Object.freeze(reviews);
}

/**
 * The two host-determined defects, read off the recorded rows.
 *
 * No row at all is `evidence-gate-absent` — true of every review produced
 * before the gate existed, which is the legacy class the edge exists to
 * migrate. The LAST row decides when several exist, because a later round's
 * measurement supersedes an earlier one's.
 */
function evidenceDefectFor(
  evidence: readonly AttemptEvidence[],
  phaseId: string,
): ReviewEvidenceDefect | null {
  let latest: boolean | null = null;
  for (const record of evidence) {
    if (record.type !== "gate") continue;
    if (record.phaseId !== phaseId || record.gateId !== REVIEW_EVIDENCE_GATE_ID) continue;
    latest = record.passed;
  }
  if (latest === null) return "evidence-gate-absent";
  return latest ? null : "evidence-gate-failed";
}

/**
 * The recorded host gate rows measured against this exact candidate.
 *
 * Review-phase rows are excluded deliberately. What an L25 request has to say
 * about those is `reviewEvidenceDefect`; letting a failed
 * `review_evidence_present` row in here would read as a failed CANDIDATE gate,
 * and the edge would refuse the very case it exists for.
 */
export function candidateGateRows(
  evidence: readonly AttemptEvidence[],
  candidateSha: string,
  reviewPhaseIds: ReadonlySet<string>,
): readonly GateEvidenceRow[] {
  const rows: GateEvidenceRow[] = [];
  for (const record of evidence) {
    if (record.type !== "gate") continue;
    if (record.candidateSha !== candidateSha || reviewPhaseIds.has(record.phaseId)) continue;
    rows.push({ gateId: record.gateId, passed: record.passed, candidateSha: record.candidateSha });
  }
  return Object.freeze(rows);
}

/** Host-authored gate evidence for a green-consuming edge, read from journal rows. */
export function candidateGateEvidence(
  evidence: readonly AttemptEvidence[],
  candidateSha: string,
  sessionId: string,
): GateEvidence {
  const reviewPhaseIds = new Set(recordedReviews(evidence, sessionId).map((review) => review.phaseId));
  const configured: ReadonlySet<string> = new Set(CANDIDATE_GATE_IDS);
  return {
    configured: CANDIDATE_GATE_IDS,
    rows: candidateGateRows(evidence, candidateSha, reviewPhaseIds).filter((row) => configured.has(row.gateId)),
  };
}

export interface RecordedSystemPrompt {
  /** Retained full composed text. */
  readonly text: string;
  readonly roleSystemDigest: string | null;
  readonly sharedBlockDigest: string | null;
  /** Derived from `text` only for a legacy record carrying no composition metadata. */
  readonly composedSystemDigest: string | null;
  readonly compositionVersion: string | null;
}

export interface RecordedRoute {
  readonly phaseId: string;
  readonly agent: string;
  readonly adapterId: string;
  readonly provider: string;
  readonly requestedModel: string;
  readonly systemPrompt: RecordedSystemPrompt | null;
}

export class PromptCompositionMismatch extends Error {
  readonly currentDigest: string;
  readonly recordedDigest: string;

  constructor(governingRole: string, currentDigest: string, recordedDigest: string, changed: readonly string[]) {
    const components = changed.length === 0 ? "" : `; changed component(s): ${changed.join(", ")}`;
    super(
      `current composed system digest ${currentDigest} does not match governing recorded ${governingRole} digest ${recordedDigest}${components}; ` +
        "config snapshot equality covers prompt paths only and cannot override digest inequality; start under a new configuration snapshot",
    );
    this.name = "PromptCompositionMismatch";
    this.currentDigest = currentDigest;
    this.recordedDigest = recordedDigest;
  }
}

export class PromptCompositionRecordMissing extends Error {
  constructor(governingRole: string) {
    super(
      `the governing recorded ${governingRole} route has no usable full-text system prompt evidence; ` +
        "start under a new configuration snapshot",
    );
    this.name = "PromptCompositionRecordMissing";
  }
}

/**
 * The route a recorded agent call actually ran on.
 *
 * `purpose` is optional on the record — journals written before tier-2
 * execution existed carry none — so the side is decided structurally, by which
 * phase wrote the record, rather than by a field that may be absent.
 */
export function recordedRoutes(
  evidence: readonly AttemptEvidence[],
  reviewPhaseIds: ReadonlySet<string>,
): { readonly worker: RecordedRoute | null; readonly review: RecordedRoute | null } {
  const systemPrompts = new Map<string, RecordedSystemPrompt>();
  for (const record of evidence) {
    if (record.type !== "compiled-prompt" || record.name !== "system") continue;
    const legacy = record.roleSystemDigest === undefined &&
      record.sharedBlockDigest === undefined &&
      record.composedSystemDigest === undefined &&
      record.compositionVersion === undefined;
    systemPrompts.set(record.phaseId, Object.freeze({
      text: record.text,
      roleSystemDigest: record.roleSystemDigest ?? null,
      // Legacy evidence records no component boundary, so no shared digest is invented.
      sharedBlockDigest: record.sharedBlockDigest ?? null,
      composedSystemDigest: legacy ? promptSha256(record.text) : record.composedSystemDigest ?? null,
      compositionVersion: record.compositionVersion ?? null,
    }));
  }

  let worker: RecordedRoute | null = null;
  let workerIsBuilder = false;
  let review: RecordedRoute | null = null;
  for (const record of evidence) {
    if (record.type !== "agent") continue;
    const route: RecordedRoute = {
      phaseId: record.phaseId,
      agent: record.agent,
      adapterId: record.adapterId,
      provider: record.provider,
      requestedModel: record.requestedModel,
      systemPrompt: systemPrompts.get(record.phaseId) ?? null,
    };
    if (reviewPhaseIds.has(record.phaseId) || record.purpose === "review") {
      review = route;
    } else if (record.purpose === "build" || record.agent === "builder" || record.phaseId.endsWith(":" + "builder")) {
      worker = route;
      workerIsBuilder = true;
    } else if (record.purpose !== "support" && (worker === null || !workerIsBuilder)) {
      // Legacy journals did not distinguish build from support. Preserve their
      // one recorded worker route without allowing a modern planner or
      // documenter to overwrite the candidate-producing provider.
      worker = route;
    }
  }
  return { worker, review };
}

/** Refuses path-stable prompt drift before a later route may reserve or spend a call. */
export function assertPromptCompositionCurrent(
  current: PromptBundle,
  governing: RecordedRoute | null,
  governingRole: string,
): void {
  const recorded = governing?.systemPrompt;
  if (recorded === null || recorded === undefined || recorded.composedSystemDigest === null) {
    throw new PromptCompositionRecordMissing(governingRole);
  }
  const retainedTextDigest = promptSha256(recorded.text);
  if (retainedTextDigest !== recorded.composedSystemDigest) {
    throw new PromptCompositionMismatch(
      governingRole,
      retainedTextDigest,
      recorded.composedSystemDigest,
      ["recorded-full-text"],
    );
  }
  if (current.evidence.composedSystemDigest === recorded.composedSystemDigest) return;
  const changed: string[] = [];
  if (recorded.roleSystemDigest !== null && current.evidence.roleSystemDigest !== recorded.roleSystemDigest) {
    changed.push("role-system");
  }
  if (recorded.sharedBlockDigest !== null && current.evidence.sharedBlockDigest !== recorded.sharedBlockDigest) {
    changed.push("shared-block");
  }
  if (recorded.compositionVersion !== null && current.evidence.compositionVersion !== recorded.compositionVersion) {
    changed.push("composition-version");
  }
  throw new PromptCompositionMismatch(
    governingRole,
    current.evidence.composedSystemDigest,
    recorded.composedSystemDigest,
    changed,
  );
}

/**
 * The lines a human gate must see when more than one review is on record: every
 * earlier verdict, why it no longer governs, and the one that does. Empty when
 * exactly one review is on record, because there is then nothing to disclose.
 *
 * Two ways an earlier review stops governing, and they are not the same fact.
 * L25 REPLACES a review of an unchanged candidate, so both name one revision
 * and the disclosure is about the defect that made the first replaceable. A T2
 * rework SUPERSEDES one by building a different candidate, so the two name
 * different revisions and nothing about the first was replaceable — saying it
 * was would tell the human gate something untrue at the last moment it could
 * act on it.
 */
export function supersededReviewLines(reviews: readonly RecordedReview[]): readonly string[] {
  if (reviews.length < 2) return Object.freeze([]);
  const current = reviews[reviews.length - 1]!;
  const lines: string[] = [];
  let anyReplaced = false;
  for (const superseded of reviews.slice(0, -1)) {
    const sameRevision = superseded.output.reviewedSha === current.output.reviewedSha;
    anyReplaced ||= sameRevision;
    lines.push(sameRevision
      ? `Superseded review (${superseded.phaseKey}): ${superseded.output.verdict} — replaceable because ${superseded.evidenceDefect ?? "its evidence gate passed"}`
      : `Superseded review (${superseded.phaseKey}): ${superseded.output.verdict} of ${superseded.output.reviewedSha} — a different revision, reworked since`);
  }
  lines.push(
    anyReplaced
      ? `Replacement review (${current.phaseKey}): ${current.output.verdict} with ${String(current.output.findings.length)} finding(s)`
      : `Current review (${current.phaseKey}): ${current.output.verdict} of ${current.output.reviewedSha} with ${String(current.output.findings.length)} finding(s)`,
  );
  return Object.freeze(lines);
}

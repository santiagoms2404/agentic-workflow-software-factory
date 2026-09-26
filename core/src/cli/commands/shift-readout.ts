// The owner's readout of one shift: which tickets ran, what each committed,
// what its gates said, what the one review found, and where the candidate is.
//
// A status projection and nothing else (W17 INV-1). Every value is read off a
// record that already exists: ticket ids and titles off the manifest and the
// recipe it rebuilds, each ticket's commit off its accepted build, its gate
// result off its accepted gate phase or the blocker that stopped it, the review
// off its accepted envelope, and the ref off Git. Nothing is measured again,
// nothing is started, and no clock is read: the owner gate is dated by the
// transition that reached it, never by how long ago that was.
import type { AcceptedPhase } from "../../contracts/phase-recovery.ts";
import { BLOCKING_SEVERITIES, type ReviewOutput } from "../../contracts/review-output.ts";
import type { TestOutput } from "../../contracts/test-output.ts";
import { candidateRefName, readCandidateRef } from "../../git/candidate-ref.ts";
import type { AttemptEvidence } from "../../observability/attempt-evidence.ts";
import type { PhaseDefinition } from "../../workflow/phase.ts";
import { bindShiftRecipe, shiftPhaseRole, shiftTicketOf } from "../../workflow/shift/bind.ts";
import type { ShiftBriefPhase } from "../../workflow/shift/compile.ts";
import type { AttemptStatus } from "./attempt.ts";

/** What Git said about the attempt's candidate ref when the readout was gathered. */
export type ShiftReadoutRef =
  | { readonly name: string; readonly commit: string | null }
  | { readonly name: string; readonly unreadable: string };

export interface ShiftReadoutInput {
  readonly status: AttemptStatus;
  /** The compiled recipe's phases, or the refusal that stopped it being rebuilt. */
  readonly phases: readonly PhaseDefinition[] | { readonly refused: string };
  readonly evidence: readonly AttemptEvidence[];
  readonly ref: ShiftReadoutRef;
}

const short = (sha: string): string => sha.slice(0, 7);
const NO_SHA = "-------";

function acceptedPayload<T>(evidence: readonly AttemptEvidence[], accepted: AcceptedPhase | undefined): T | null {
  if (accepted === undefined) return null;
  const record = evidence.findLast((entry) => entry.type === "envelope" && entry.envelope.envelopeId === accepted.envelopeId);
  return record?.type === "envelope" ? (record.envelope.payload as T | null) : null;
}

function gateColumn(tests: TestOutput | null): string {
  if (tests === null) return "gates unrecorded";
  const green = tests.commands.filter((command) => command.exitCode === 0).length;
  return `gates ${String(green)}/${String(tests.commands.length)}`;
}

/** The ticket rows, in run order. The ticket a blocker stopped is the red row. */
function ticketRows(input: ShiftReadoutInput, phases: readonly PhaseDefinition[]): string[] {
  const { status, evidence } = input;
  const prefix = new Map((status.recovery?.prefix ?? []).map((entry) => [entry.phaseKey, entry]));
  const stoppedAt = status.blocker === null ? null : status.recovery?.ticket ?? null;
  const rows: string[] = [];
  for (const phase of phases) {
    if (!("ticketId" in phase)) continue;
    const brief = phase as ShiftBriefPhase;
    const id = brief.ticketId;
    const title = brief.intent.implementationSteps[0]?.title ?? "";
    const own = phases.filter((candidate) => shiftTicketOf(phases, candidate.id) === id);
    const build = own.find((candidate) => shiftPhaseRole(phases, candidate.id) === "builder");
    const tests = own.find((candidate) => shiftPhaseRole(phases, candidate.id) === "tests");
    const built = build === undefined ? undefined : prefix.get(build.id);
    const sha = built?.candidateSha == null ? NO_SHA : short(built.candidateSha);
    if (id === stoppedAt && status.blocker !== null) {
      // A red suite and a command that never reported are different findings
      // about the ticket, so they never share a word.
      const measured = status.blocker.source === "gate" ? "RED: gates red"
        : status.blocker.source === "process" ? "RED: gates not measured" : "RED: blocked";
      rows.push(`  ${id}  ${title}  ${sha}  ${measured}`);
      rows.push(`       ${status.blocker.detail}`);
      continue;
    }
    if (built === undefined) {
      rows.push(`  ${id}  ${title}  ${sha}  not run`);
      continue;
    }
    const measured = tests === undefined ? undefined : prefix.get(tests.id);
    rows.push(`  ${id}  ${title}  ${sha}  ${measured === undefined ? "gates pending" : gateColumn(acceptedPayload<TestOutput>(evidence, measured))}`);
  }
  return rows;
}

/** The one review over the accumulated diff: its findings once, blocking counted apart from the total. */
function reviewLines(input: ShiftReadoutInput, phases: readonly PhaseDefinition[]): string[] {
  const { status, evidence } = input;
  const reviewer = phases.find((phase) => shiftPhaseRole(phases, phase.id) === "reviewer");
  const accepted = reviewer === undefined ? undefined : status.recovery?.prefix.find((entry) => entry.phaseKey === reviewer.id);
  const output = acceptedPayload<ReviewOutput>(evidence, accepted);
  if (accepted === undefined || output === null) {
    return ["Shift review: not run — the one review reads every ticket's commit together, after the last ticket's gates"];
  }
  const envelope = evidence.findLast((entry) => entry.type === "envelope" && entry.envelope.envelopeId === accepted.envelopeId);
  const phaseId = envelope?.type === "envelope" ? envelope.phaseId : null;
  const agent = evidence.findLast((entry) => entry.type === "agent" && entry.phaseId === phaseId);
  const route = agent?.type === "agent" ? `${agent.adapterId}/${agent.resolvedModel ?? agent.requestedModel}` : "an unrecorded route";
  const blocking = output.findings.filter((finding) => (BLOCKING_SEVERITIES as readonly string[]).includes(finding.severity)).length;
  const lines = [
    `Shift review: ${output.verdict} by ${route} on ${short(output.reviewedSha)} for the accumulated diff — ` +
      `${String(output.findings.length)} finding(s), ${String(blocking)} blocking`,
  ];
  for (const finding of output.findings) {
    const where = finding.line === null ? finding.file : `${finding.file}:${String(finding.line)}`;
    const mark = (BLOCKING_SEVERITIES as readonly string[]).includes(finding.severity) ? " BLOCKING" : "";
    lines.push(`  ${finding.id} ${finding.severity}${mark} ${where} — ${finding.title}`);
  }
  return lines;
}

function refLine(input: ShiftReadoutInput): string {
  const { status, ref } = input;
  if ("unreadable" in ref) return `Candidate ref: ${ref.name} could not be read — ${ref.unreadable}`;
  if (ref.commit === null) {
    return status.lifecycleState === "AWAITING_OWNER"
      ? `Candidate ref: ${ref.name} is missing — this attempt predates the ref or its write failed; the candidate is reachable only through its worktree`
      : `Candidate ref: ${ref.name} is not written — it is written when the attempt reaches the owner gate or seals`;
  }
  if (status.candidateSha !== null && ref.commit !== status.candidateSha) {
    return `Candidate ref: ${ref.name} names ${ref.commit}, not this attempt's candidate ${status.candidateSha}`;
  }
  return `Candidate ref: ${ref.name} at ${ref.commit} — reach it with \`git log ${ref.name}\`; no worktree is needed`;
}

/** Dated by the transition into AWAITING_OWNER. Nothing runs from that date: L20 is a human act at a TTY. */
function ownerGateLine(input: ShiftReadoutInput): string[] {
  if (input.status.lifecycleState !== "AWAITING_OWNER") return [];
  const reached = input.evidence.findLast((entry) => entry.type === "transition" && entry.to === "AWAITING_OWNER");
  const at = reached?.type === "transition" ? reached.at : "an unrecorded time";
  return [
    `Owner gate: AWAITING_OWNER since ${at} — it waits for the owner; \`awsf land ${input.status.taskId}\` needs an interactive terminal`,
  ];
}

/** The shift readout's lines. Pure: the caller gathers the records, this only prints them. */
export function formatShiftReadout(input: ShiftReadoutInput): readonly string[] {
  const manifest = input.status.shift;
  if (manifest == null) return Object.freeze([]);
  const lines = [
    `Shift: plan ${manifest.plan}, milestone ${manifest.milestones.join(", ")}, ${String(manifest.tickets.length)} ticket(s) — ` +
      `each row is a recorded result, not a new measurement`,
  ];
  if ("refused" in input.phases) {
    lines.push(`  the recipe cannot be rebuilt from the recorded selection: ${input.phases.refused}`);
  } else {
    lines.push(...ticketRows(input, input.phases), ...reviewLines(input, input.phases));
  }
  lines.push(refLine(input), ...ownerGateLine(input));
  return Object.freeze(lines);
}

/** Gathers the readout's records for `awsf status`. Reads the ticket files and Git; writes and starts nothing. */
export async function shiftReadout(status: AttemptStatus, evidence: readonly AttemptEvidence[]): Promise<readonly string[]> {
  if (status.shift == null) return Object.freeze([]);
  let phases: ShiftReadoutInput["phases"];
  try {
    // The prompts shape no ticket's membership, title or order, so none are read.
    phases = (await bindShiftRecipe(status.repository, status.shift, { prompts: { builder: "", reviewer: "" } })).phases;
  } catch (error) {
    phases = { refused: error instanceof Error ? error.message : String(error) };
  }
  const name = candidateRefName(status);
  let ref: ShiftReadoutRef;
  try {
    ref = { name, commit: readCandidateRef(status.repository, status) };
  } catch (error) {
    ref = { name, unreadable: error instanceof Error ? error.message : String(error) };
  }
  return formatShiftReadout({ status, phases, evidence, ref });
}

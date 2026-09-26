import assert from "node:assert/strict";
import { test } from "node:test";
import type { AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { formatShiftReadout, type ShiftReadoutInput, type ShiftReadoutRef } from "../../src/cli/commands/shift-readout.ts";
import type { PreviewRecord } from "../../src/contracts/preview-record.ts";
import type { AcceptedPhase, PhaseRecovery } from "../../src/contracts/phase-recovery.ts";
import type { ReviewFinding, ReviewOutput } from "../../src/contracts/review-output.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import type { TestOutput } from "../../src/contracts/test-output.ts";
import { candidateRefName } from "../../src/git/candidate-ref.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { compileShift } from "../../src/workflow/shift/compile.ts";

// W17 M5 task 14. The readout is a pure projection of records, so it is tested
// as one: golden text over a fixture attempt, with no git, no server and no
// clock. The records are the shapes the runner writes, read off a real fixture
// run: a `phase-accepted` prefix naming envelope ids, the envelopes themselves,
// the review's `agent` row and the transition into AWAITING_OWNER.

const PLAN = "awsf-v2-w07-quota-telemetry";
const TASK = "w07-m4-shift";
const SESSION = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const TICKETS = [
  ["T11", "Boundary snapshot writer"],
  ["T12", "Effective-availability readout"],
  ["T13", "Route-scoped reason codes"],
  ["T14", "L26 stop without a timer"],
  ["T15", "Milestone M4 testing strategy"],
] as const;
const SHAS = ["9f3ac21", "c40b7e8", "1ad5502", "77be9f1", "e2c8d43"].map((prefix) => prefix.padEnd(40, "0"));
const BASE = "0".repeat(40);
const ENCODER = new TextEncoder();

function ticketSource(id: string, title: string): string {
  return [
    "---", `id: ${id}`, `title: ${JSON.stringify(title)}`, "milestone: M4", "state: todo", "depends_on: []", "---",
    `# ${id} · ${title}`, "", "## Handoff", "", "_Empty._", "", "## Build prompt", "", "```", `TASK ${id}.`, "```", "",
  ].join("\n");
}

const bodies = new Map(TICKETS.map(([id, title]) => [id, ENCODER.encode(ticketSource(id, title))]));
const manifest = sealShiftManifest({
  plan: PLAN, milestones: ["M4"],
  tickets: TICKETS.map(([id]) => ({ id, path: `specs/tickets/${PLAN}/${id}.md`, digest: ticketFileDigest(bodies.get(id)!) })),
});
const phases = compileShift(manifest, bodies, { prompts: { builder: "builder", reviewer: "reviewer" } }).phases;
const REF = candidateRefName({ project: "agentic-workflow-software-factory", taskId: TASK, attempt: 1 });

const envelopeId = (phaseKey: string): string => `${SESSION}:${phaseKey}:0`;

function envelope(phaseKey: string, schemaId: string, payload: unknown): AttemptEvidence {
  return {
    type: "envelope", phaseId: `${SESSION}:${phaseKey}`,
    envelope: {
      envelopeId: envelopeId(phaseKey), sessionId: SESSION, phaseId: `${SESSION}:${phaseKey}`, correctionRound: 0, agent: "host",
      schemaId, valid: true, createdAt: "2026-09-25T04:00:00.000Z", payload: payload as never, violations: [], rawOutputPath: "raw/x.json",
    },
  };
}

function testsPassed(candidateSha: string): TestOutput {
  const command = (gateId: string) => ({ gateId, argv: ["npm", "run", gateId], exitCode: 0, durationMs: 1, outputRef: `raw/${gateId}.txt` });
  return {
    schema: "awsf.test-output/v1", producerStatus: "success", summary: "all configured commands passed", artifacts: [],
    notesForNextPhase: "await owner", passed: true, candidateSha, commands: [command("test"), command("typecheck"), command("lint")],
    failures: [], outputTail: "",
  };
}

const FINDINGS: ReviewFinding[] = [
  { id: "F1", severity: "medium", file: "core/src/quota/snapshot.ts", line: 42, title: "The boundary snapshot drops the reset clock's zone",
    detail: "d", consequence: "c", evidence: "e" },
  { id: "F2", severity: "high", file: "core/src/quota/readout.ts", line: null, title: "Effective availability double-counts a paused scope",
    detail: "d", consequence: "c", evidence: "e" },
];

function review(candidateSha: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "reviewed", artifacts: [], notesForNextPhase: "owner",
    verdict: "concern", reviewedSha: candidateSha, findings: FINDINGS, limitations: [],
  };
}

/** Accepted prefix entries plus the evidence rows the runner writes beside them, for every phase up to `through`. */
function run(through: string): { prefix: AcceptedPhase[]; evidence: AttemptEvidence[] } {
  const prefix: AcceptedPhase[] = [];
  const evidence: AttemptEvidence[] = [];
  let head: string | null = null;
  for (const phase of phases) {
    const ticket = TICKETS.findIndex(([id]) => phase.id.startsWith(id.toLowerCase()));
    if (phase.id.endsWith("-build")) head = SHAS[ticket]!;
    if (phase.id.endsWith("-tests")) evidence.push(envelope(phase.id, "awsf.test-output/v1", testsPassed(head!)));
    if (phase.id === "shift-review") {
      evidence.push({ type: "agent", phaseId: `${SESSION}:shift-review`, adapterId: "codex", resolvedModel: "gpt-5.6" } as unknown as AttemptEvidence);
      evidence.push(envelope(phase.id, "awsf.review-output/v1", review(head!)));
    }
    prefix.push({ phaseKey: phase.id, ordinal: prefix.length + 1, envelopeId: envelopeId(phase.id), envelopeDigest: "a".repeat(64), round: 0, candidateSha: head });
    if (phase.id === through) break;
  }
  return { prefix, evidence };
}

function recovery(kind: PhaseRecovery["kind"], prefix: AcceptedPhase[], ticket?: string): PhaseRecovery {
  return {
    schema: "awsf.phase-recovery/v1", id: "checkpoint", sessionId: SESSION, kind, ...(ticket === undefined ? {} : { ticket }),
    workflowId: "shift", bindingDigest: "b".repeat(64), prefix, repository: "/repo", worktree: "/worktree", commonGitDir: "/repo/.git",
    integrationBaseSha: BASE, worktreeHeadSha: prefix.at(-1)?.candidateSha ?? BASE, budgetDigest: "c".repeat(64), quota: null,
    createdAt: "2026-09-25T04:51:00.000Z",
  };
}

function attempt(overrides: Partial<AttemptStatus>): AttemptStatus {
  return {
    schema: "awsf/attempt-status/v1", sessionId: SESSION, project: "agentic-workflow-software-factory", taskId: TASK,
    continuesTask: null, groupId: null, planRef: null, attempt: 1, repository: "/repo", worktree: "/worktree", workflow: "shift",
    tier: 2, request: "run milestone M4", configSnapshotJson: "{}", lifecycleState: "AWAITING_OWNER", baseSha: BASE,
    candidateSha: SHAS[4]!, shift: manifest, phase: null,
    budget: { attempt: 1, callsSpent: 6, callsReserved: 0, correctionsAuto: 0, correctionsOwner: 0, ownerReentries: 0,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 }, ceiling: 10 },
    ceilingGrants: [], routeOverrides: {}, reviewDegradation: null, model: null, lastActivityAt: "2026-09-25T04:51:00.000Z",
    lastActivity: "review returned concern", nextAction: "land", gatesPass: true, requiredReviewPresent: true, journeyApproved: false,
    protectedApprovalsValid: true, process: null, landingApproval: null, blocker: null, revision: 40, lastSourceSeq: 40,
    ...overrides,
  };
}

const AWAITING = { type: "transition", to: "AWAITING_OWNER", at: "2026-09-25T04:51:07.718Z" } as unknown as AttemptEvidence;

test("golden: a clean five-ticket shift at the owner gate", () => {
  const { prefix, evidence } = run("shift-review");
  const lines = formatShiftReadout({
    status: attempt({ recovery: recovery("completed-phase", prefix) }),
    phases, evidence: [...evidence, AWAITING], ref: { name: REF, commit: SHAS[4]! },
  });
  assert.deepEqual(lines, [
    "Shift: plan awsf-v2-w07-quota-telemetry, milestone M4, 5 ticket(s) — each row is a recorded result, not a new measurement",
    "  T11  Boundary snapshot writer  9f3ac21  gates 3/3",
    "  T12  Effective-availability readout  c40b7e8  gates 3/3",
    "  T13  Route-scoped reason codes  1ad5502  gates 3/3",
    "  T14  L26 stop without a timer  77be9f1  gates 3/3",
    "  T15  Milestone M4 testing strategy  e2c8d43  gates 3/3",
    "Shift review: concern by codex/gpt-5.6 on e2c8d43 for the accumulated diff — 2 finding(s), 1 blocking",
    "  F1 medium core/src/quota/snapshot.ts:42 — The boundary snapshot drops the reset clock's zone",
    "  F2 high BLOCKING core/src/quota/readout.ts — Effective availability double-counts a paused scope",
    `Candidate ref: ${REF} at ${SHAS[4]!} — reach it with \`git log ${REF}\`; no worktree is needed`,
    "Preview: not built — `awsf preview w07-m4-shift` builds the candidate fresh in the form its delivery posture declares",
    "Owner gate: AWAITING_OWNER since 2026-09-25T04:51:07.718Z — it waits for the owner; `awsf land w07-m4-shift` needs an interactive terminal",
  ]);
});

test("golden: the same shift blocked at ticket 3 — that row red, the tail not run, no review and no ref", () => {
  const { prefix, evidence } = run("t13-build");
  const detail = `ticket T13 (t13-tests) blocked the shift: gate commands_pass is red on ${SHAS[2]!}: test exited 1`;
  const lines = formatShiftReadout({
    status: attempt({
      lifecycleState: "RUNNING", candidateSha: SHAS[2]!, recovery: recovery("ticket-block", prefix, "T13"),
      blocker: { code: "phase-abort", detail, ahead: null, behind: null, source: "gate" },
    }),
    phases, evidence, ref: { name: REF, commit: null },
  });
  assert.deepEqual(lines, [
    "Shift: plan awsf-v2-w07-quota-telemetry, milestone M4, 5 ticket(s) — each row is a recorded result, not a new measurement",
    "  T11  Boundary snapshot writer  9f3ac21  gates 3/3",
    "  T12  Effective-availability readout  c40b7e8  gates 3/3",
    "  T13  Route-scoped reason codes  1ad5502  RED: gates red",
    `       ${detail}`,
    "  T14  L26 stop without a timer  -------  not run",
    "  T15  Milestone M4 testing strategy  -------  not run",
    "Shift review: not run — the one review reads every ticket's commit together, after the last ticket's gates",
    `Candidate ref: ${REF} is not written — it is written when the attempt reaches the owner gate or seals`,
  ]);
});

test("a gate that reported no exit status reads as not measured, never as red", () => {
  const { prefix, evidence } = run("t13-build");
  const detail = `ticket T13 (t13-tests) blocked the shift: test reported no exit status on ${SHAS[2]!}, so the host could not measure it and the cause may not be this ticket`;
  const lines = formatShiftReadout({
    status: attempt({
      lifecycleState: "RUNNING", recovery: recovery("ticket-block", prefix, "T13"),
      blocker: { code: "phase-abort", detail, ahead: null, behind: null, source: "process" },
    }),
    phases, evidence, ref: { name: REF, commit: null },
  });
  assert.ok(lines.includes("  T13  Route-scoped reason codes  1ad5502  RED: gates not measured"), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes("gates red")));
});

test("the ref line says when the ref is missing, names another commit, or cannot be read, and never prints a bare name", () => {
  const { prefix, evidence } = run("shift-review");
  const base: Omit<ShiftReadoutInput, "ref"> = { status: attempt({ recovery: recovery("completed-phase", prefix) }), phases, evidence };
  const line = (ref: ShiftReadoutRef) => formatShiftReadout({ ...base, ref }).find((entry) => entry.startsWith("Candidate ref:"));
  assert.equal(line({ name: REF, commit: null }),
    `Candidate ref: ${REF} is missing — this attempt predates the ref or its write failed; the candidate is reachable only through its worktree`);
  assert.equal(line({ name: REF, commit: SHAS[3]! }), `Candidate ref: ${REF} names ${SHAS[3]!}, not this attempt's candidate ${SHAS[4]!}`);
  assert.equal(line({ name: REF, unreadable: "not a git repository" }), `Candidate ref: ${REF} could not be read — not a git repository`);
});

test("a recipe that cannot be rebuilt is said, not guessed around; a non-shift attempt prints nothing", () => {
  const lines = formatShiftReadout({
    status: attempt({}), phases: { refused: "ticket T12 changed since selection" }, evidence: [], ref: { name: REF, commit: SHAS[4]! },
  });
  assert.equal(lines[1], "  the recipe cannot be rebuilt from the recorded selection: ticket T12 changed since selection");
  assert.deepEqual(formatShiftReadout({ status: attempt({ shift: null }), phases, evidence: [], ref: { name: REF, commit: null } }), []);
});

test("the preview line reads what the preview recorded: where it serves, what it built and when, or why it built nothing", () => {
  const { prefix, evidence } = run("shift-review");
  const base: Omit<ShiftReadoutInput, "preview"> = {
    status: attempt({ recovery: recovery("completed-phase", prefix) }), phases, evidence: [...evidence, AWAITING], ref: { name: REF, commit: SHAS[4]! },
  };
  const line = (preview: NonNullable<ShiftReadoutInput["preview"]>) => formatShiftReadout({ ...base, preview }).find((entry) => entry.startsWith("Preview:"));
  const served: PreviewRecord = {
    schema: "awsf.preview/v1", posture: "service", form: "serve", visual: true, reason: "1 changed path(s) are under this service's preview sources",
    baseSha: BASE, candidateSha: SHAS[4]!, changedPaths: 3, visualPaths: ["dashboard/src/App.vue"], recordedAt: "2026-09-25T04:51:30.000Z",
    build: { argv: ["npm", "run", "dash:build"], bundle: "dashboard/dist", files: 7 }, server: { url: "http://127.0.0.1:5173/", pid: 4242 },
  };
  assert.equal(line({ record: served, serving: true }),
    "Preview: delivery service — built fresh 2026-09-25T04:51:30.000Z from e2c8d43 by `npm run dash:build` · serving at http://127.0.0.1:5173/ (pid 4242)");
  assert.equal(line({ record: served, serving: false }),
    "Preview: delivery service — built fresh 2026-09-25T04:51:30.000Z from e2c8d43 by `npm run dash:build` · not serving now — `awsf preview w07-m4-shift` builds and serves it again");
  assert.equal(line({ record: { ...served, candidateSha: SHAS[3]! }, serving: true }),
    "Preview: recorded for 77be9f1, not this candidate — run `awsf preview w07-m4-shift` again");
  const mobile: PreviewRecord = { ...served, posture: "mobile", form: "named-not-built", reason: "an emulator is not a browser", build: null, server: null };
  assert.equal(line({ record: mobile, serving: false }), "Preview: delivery mobile — named, not built (2026-09-25T04:51:30.000Z): an emulator is not a browser");
  const docs: PreviewRecord = { ...mobile, posture: "docs", form: "diff-readout", visual: false, reason: "docs are read, not rendered" };
  assert.equal(line({ record: docs, serving: false }), "Preview: delivery docs — diff readout only (2026-09-25T04:51:30.000Z): docs are read, not rendered");
  // Only the owner gate has a candidate to preview.
  assert.equal(formatShiftReadout({ ...base, status: attempt({ lifecycleState: "RUNNING" }), preview: { record: served, serving: true } })
    .find((entry) => entry.startsWith("Preview:")), undefined);
});

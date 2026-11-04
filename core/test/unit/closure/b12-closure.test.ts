import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCommand, ClosureRefused } from "../../../src/cli/commands/close.ts";
import { withClosureJournal } from "../../../src/persistence/closure-journal.ts";
import { agreementTicket, treeAgreement, type ClosureRegistry, type ClosureTree } from "../../../src/closure/tree.ts";
import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { JournalRecord } from "../../../src/persistence/journal.ts";
import type { AttemptEvent } from "../../../src/cli/commands/attempt.ts";
import { planAgreement } from "../../../src/registry/plan-agreement.ts";
import { parseAwsfPlanHtmlV1 } from "../../../src/registry/plan-source.ts";

const fixturePlanHtml = `<section id="phases">
<h3><code class="status">[]</code> Milestone M1: One</h3>
<h4>1. First task</h4>
<ul><li><code class="status">[]</code> First row.</li></ul>
</section>\n`;

const ticketSourceWithTier = (tierValue: string) => `---
id: T01
title: First task
milestone: M1
${tierValue}
state: todo
depends_on: []
workflow: build-review
---
# Ticket

## Handoff

Findings.

## Build prompt

\`\`\`
Build T01.
\`\`\`
`;

function createAttemptDir(lifecycleState: "LANDED" | "PUBLISHED" | "DRAFT" | "AWAITING_OWNER"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "awsf-b12-closure-test-"));
  const status: AttemptStatus = {
    schema: "awsf/attempt-status/v1",
    sessionId: "test-session",
    project: "sample",
    taskId: "T01",
    continuesTask: null,
    groupId: null,
    planRef: null,
    attempt: 1,
    repository: dir,
    worktree: dir,
    workflow: "build-review",
    tier: 1,
    request: "test request",
    configSnapshotJson: "{}",
    lifecycleState,
    baseSha: "0".repeat(40),
    candidateSha: "1".repeat(40),
    phase: null,
    budget: {
      attempt: 1,
      callsSpent: 0,
      callsReserved: 0,
      correctionsAuto: 0,
      correctionsOwner: 0,
      ownerReentries: 0,
      allowance: { auto: 1, owner: 1, ownerReentries: 1 },
      ceiling: 10,
    },
    ceilingGrants: [],
    routeOverrides: {},
    reviewDegradation: null,
    model: null,
    lastActivityAt: "2026-10-09T00:00:00.000Z",
    lastActivity: "created",
    nextAction: "none",
    gatesPass: true,
    requiredReviewPresent: false,
    journeyApproved: false,
    protectedApprovalsValid: false,
    process: null,
    landingApproval: null,
    blocker: null,
    revision: 1,
    lastSourceSeq: 1,
    seed: null,
    shift: null,
    ticketSelection: {
      plan: "sample",
      tickets: [{ id: "T01", path: "specs/tickets/sample/T01.md", digest: "a".repeat(64) }],
      selectionDigest: "a".repeat(64),
    },
  };
  const event: JournalRecord<AttemptEvent> = {
    source_seq: 1,
    recorded_at: "2026-10-09T00:00:00Z",
    event: {
      kind: "attempt.created",
      next: status,
    },
  };
  writeFileSync(join(dir, "status.json"), JSON.stringify(status, null, 2));
  writeFileSync(join(dir, "journal.jsonl"), JSON.stringify(event) + "\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// 1. B12-05: closeCommand and withClosureJournal allow PUBLISHED attempts
// ---------------------------------------------------------------------------
test("B12-05: withClosureJournal permits PUBLISHED attempt and refuses DRAFT", async () => {
  const published = createAttemptDir("PUBLISHED");
  try {
    let ran = false;
    await withClosureJournal(published.dir, undefined, async (status) => {
      ran = true;
      assert.equal(status.lifecycleState, "PUBLISHED");
    });
    assert.equal(ran, true);
  } finally {
    published.cleanup();
  }

  const draft = createAttemptDir("DRAFT");
  try {
    await assert.rejects(
      async () => withClosureJournal(draft.dir, undefined, async () => {}),
      /closure requires a LANDED attempt/,
    );
  } finally {
    draft.cleanup();
  }
});

test("B12-05: closeCommand does not reject PUBLISHED attempt with E_CLOSURE_NOT_LANDED", async () => {
  const published = createAttemptDir("PUBLISHED");
  const terminal = { interactive: true, write: () => {}, confirm: async () => true };
  try {
    // It should proceed past the lifecycle check; it will fail on repository/git
    // operations because the mock attemptDir is not a real git repo, not on E_CLOSURE_NOT_LANDED.
    await assert.rejects(
      async () => closeCommand({ attemptDir: published.dir, terminal }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        if (err instanceof ClosureRefused) {
          assert.notEqual(err.code, "E_CLOSURE_NOT_LANDED");
        }
        return true;
      },
    );
  } finally {
    published.cleanup();
  }

  const draft = createAttemptDir("DRAFT");
  try {
    await assert.rejects(
      async () => closeCommand({ attemptDir: draft.dir, terminal }),
      (err: unknown) => {
        assert.ok(err instanceof ClosureRefused);
        assert.equal(err.code, "E_CLOSURE_NOT_LANDED");
        return true;
      },
    );
  } finally {
    draft.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2. B12-07: agreementTicket strict tier parsing
// ---------------------------------------------------------------------------
test("B12-07: agreementTicket strictly parses tier and does not coerce null, true, or quoted strings", () => {
  const parsedNull = agreementTicket(ticketSourceWithTier("tier:"), "specs/tickets/sample/T01.md");
  assert.equal(parsedNull.tier, null);

  const parsedTrue = agreementTicket(ticketSourceWithTier("tier: true"), "specs/tickets/sample/T01.md");
  assert.equal(parsedTrue.tier, true);

  const parsedQuoted = agreementTicket(ticketSourceWithTier('tier: "2"'), "specs/tickets/sample/T01.md");
  assert.equal(parsedQuoted.tier, "2");

  const parsedEmpty = agreementTicket(ticketSourceWithTier('tier: ""'), "specs/tickets/sample/T01.md");
  assert.equal(parsedEmpty.tier, "");

  const parsedFloat = agreementTicket(ticketSourceWithTier("tier: 1.5"), "specs/tickets/sample/T01.md");
  assert.equal(parsedFloat.tier, 1.5);

  const parsedValid0 = agreementTicket(ticketSourceWithTier("tier: 0"), "specs/tickets/sample/T01.md");
  assert.equal(parsedValid0.tier, 0);

  const parsedValid1 = agreementTicket(ticketSourceWithTier("tier: 1"), "specs/tickets/sample/T01.md");
  assert.equal(parsedValid1.tier, 1);

  const parsedValid2 = agreementTicket(ticketSourceWithTier("tier: 2"), "specs/tickets/sample/T01.md");
  assert.equal(parsedValid2.tier, 2);

  const parsedOmitted = agreementTicket(ticketSourceWithTier(""), "specs/tickets/sample/T01.md");
  assert.equal(parsedOmitted.tier, undefined);
});

test("B12-07: planAgreement flags uncoerced null, true, '2', '' as VOCABULARIES violations", () => {
  const plan = parseAwsfPlanHtmlV1(fixturePlanHtml, "sample");
  const checkTier = (tierValue: string) => {
    const ticket = agreementTicket(ticketSourceWithTier(tierValue), "specs/tickets/sample/T01.md");
    return planAgreement({
      label: "sample",
      plan,
      tickets: [ticket],
      sectionB: new Map([[1, { title: "First task", prompt: "Build T01." }]]),
      knownStems: ["sample"],
    });
  };

  const violationsNull = checkTier("tier:").filter(v => v.rule === "VOCABULARIES");
  assert.equal(violationsNull.length, 1);
  assert.match(violationsNull[0]!.message, /tier "null"/);

  const violationsTrue = checkTier("tier: true").filter(v => v.rule === "VOCABULARIES");
  assert.equal(violationsTrue.length, 1);
  assert.match(violationsTrue[0]!.message, /tier "true"/);

  const violationsQuoted = checkTier('tier: "2"').filter(v => v.rule === "VOCABULARIES");
  assert.equal(violationsQuoted.length, 1);
  assert.match(violationsQuoted[0]!.message, /tier "2"/);

  const violationsEmpty = checkTier('tier: ""').filter(v => v.rule === "VOCABULARIES");
  assert.equal(violationsEmpty.length, 1);
  assert.match(violationsEmpty[0]!.message, /tier ""/);

  const violationsValid1 = checkTier("tier: 1").filter(v => v.rule === "VOCABULARIES");
  assert.deepEqual(violationsValid1, []);

  const violationsOmitted = checkTier("").filter(v => v.rule === "VOCABULARIES");
  assert.deepEqual(violationsOmitted, []);
});

// ---------------------------------------------------------------------------
// 3. B12-08: treeAgreement detects orphan ticket sets
// ---------------------------------------------------------------------------
test("B12-08: treeAgreement flags orphan ticket sets without a resolved plan", () => {
  const tree: ClosureTree = new Map<string, Uint8Array>([
    ["specs/sample.html", Buffer.from(fixturePlanHtml)],
    ["specs/sample-build-prompts.md", Buffer.from("# Section B — Task prompts (recommended)\n### T01 — First task\n\n```\nBuild T01.\n```\n")],
    ["specs/tickets/sample/T01.md", Buffer.from(ticketSourceWithTier("tier: 1"))],
    // Orphan ticket set: under specs/tickets/orphan, but no specs/orphan.html registered
    ["specs/tickets/orphan/T01.md", Buffer.from(ticketSourceWithTier("tier: 1"))],
  ]);

  const registry: ClosureRegistry = {
    plans: [
      {
        project: "sample-project",
        repositoryId: "app",
        label: "sample",
        planPath: "specs/sample.html",
        ticketsPath: "specs/tickets/sample",
        promptsPath: "specs/sample-build-prompts.md",
        format: "awsf-plan-html/v1",
      },
    ],
  };

  const violations = treeAgreement(tree, registry);
  const orphanViolations = violations.filter(v => v.message.includes("has a ticket set but no resolved plan"));
  assert.equal(orphanViolations.length, 1);
  assert.equal(orphanViolations[0]!.plan, "orphan");
  assert.equal(orphanViolations[0]!.rule, "TICKET_COVERAGE");
  assert.equal(
    orphanViolations[0]!.message,
    "plan source sample-project/app/orphan has a ticket set but no resolved plan. A ticket set without a plan cannot be checked against anything.",
  );
});

test("B12-08: treeAgreement passes when all ticket sets correspond to registered plans", () => {
  const tree: ClosureTree = new Map<string, Uint8Array>([
    ["specs/sample.html", Buffer.from(fixturePlanHtml)],
    ["specs/sample-build-prompts.md", Buffer.from("# Section B — Task prompts (recommended)\n### T01 — First task\n\n```\nBuild T01.\n```\n")],
    ["specs/tickets/sample/T01.md", Buffer.from(ticketSourceWithTier("tier: 1"))],
  ]);

  const registry: ClosureRegistry = {
    plans: [
      {
        project: "sample-project",
        repositoryId: "app",
        label: "sample",
        planPath: "specs/sample.html",
        ticketsPath: "specs/tickets/sample",
        promptsPath: "specs/sample-build-prompts.md",
        format: "awsf-plan-html/v1",
      },
    ],
  };

  const violations = treeAgreement(tree, registry);
  const orphanViolations = violations.filter(v => v.message.includes("has a ticket set but no resolved plan"));
  assert.deepEqual(orphanViolations, []);
});

// `awsf raise` — the owner act that moves ONE task's ceiling while its attempt
// is live.
//
// Everything here is about the four properties that make it a decision rather
// than an escape hatch: interactive-only, bounded, task-scoped, and recorded
// with the owner's reason. The journey suite proves the fifth — that an attempt
// which halted at its ceiling resumes afterwards with no configuration-snapshot
// mismatch — because only a journey can prove that.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../src/cli/main.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import {
  CeilingRaiseAttemptNotLive,
  CeilingRaiseBeyondBound,
  CeilingRaiseCredentialRejected,
  CeilingRaiseInvalid,
  CeilingRaiseNotInteractive,
  CeilingRaiseReasonRequired,
  MAX_GRANT_CALLS,
  raiseCommand,
} from "../../../src/cli/commands/raise.ts";
import { retryCommand } from "../../../src/cli/commands/retry.ts";
import { statusCommand } from "../../../src/cli/commands/status.ts";
import { MAX_CALL_CEILING, callCeilingsOf } from "../../../src/state/tiers.ts";
import type { OwnerTerminal } from "../../../src/cli/tty.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";

const AT = "2026-08-16T00:00:00.000Z";
const REASON = "the replacement review needs two calls and one remained";
const PROJECT = "agentic-workflow-software-factory";

function terminal(answer: boolean, interactive = true, lines: string[] = []): OwnerTerminal {
  return { interactive, write: (line) => { lines.push(line); }, confirm: async () => answer };
}

async function attempt(root: string, taskId: string, tier: 0 | 1 | 2 = 2): Promise<string> {
  const created = await newCommand({
    stateRoot: join(root, "state"),
    project: PROJECT,
    taskId,
    repository: resolve("."),
    request: "prove the ceiling is a checkpoint",
    workflow: tier === 2 ? "build-review" : "build",
    tier,
    callCeilings: callCeilingsOf({ T0: 1, T1: 3, T2: 5 }),
    now: () => AT,
    sessionId: () => `${taskId}-session`,
  });
  return created.attemptDir;
}

function grants(attemptDir: string): AttemptEvidence[] {
  return readFileSync(join(attemptDir, "journal.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { event?: { evidence?: AttemptEvidence } }).event?.evidence)
    .filter((evidence): evidence is AttemptEvidence => evidence?.type === "ceiling-grant");
}

async function withRoot(name: string, body: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), `awsf-raise-${name}-`));
  try {
    await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a new attempt records the CONFIGURED ceiling, not a hardcoded one", async () => {
  await withRoot("configured", async (root) => {
    const created = await newCommand({
      stateRoot: join(root, "state"), project: PROJECT, taskId: "configured-dial",
      repository: resolve("."), request: "prove the dial is connected", workflow: "build-review", tier: 2,
      callCeilings: callCeilingsOf({ T0: 1, T1: 3, T2: 9 }),
    });
    assert.equal(created.status.budget.ceiling, 9, "risk.call_ceiling reached the attempt");
    const lines = await statusCommand(created.attemptDir);
    assert.ok(lines.some((line) => line.startsWith("Calls: 0/9 spent")), lines.join("\n"));
  });
});

test("a piped owner is refused before anything is written", async () => {
  await withRoot("piped", async (root) => {
    const dir = await attempt(root, "piped-owner");
    const before = await readAttempt(dir);
    await assert.rejects(
      raiseCommand({ attemptDir: dir, calls: 1, reason: REASON, terminal: terminal(true, false) }),
      CeilingRaiseNotInteractive,
    );
    const after = await readAttempt(dir);
    assert.equal(after.revision, before.revision, "no record was written");
    assert.equal(after.budget.ceiling, 5);
    assert.deepEqual(after.ceilingGrants, []);
    assert.deepEqual(grants(dir), []);
  });
});

test("the reason is required, bounded and credential-checked", async () => {
  await withRoot("reason", async (root) => {
    const dir = await attempt(root, "reason-required");
    for (const reason of ["", "   ", "\n\t "]) {
      await assert.rejects(
        raiseCommand({ attemptDir: dir, calls: 1, reason, terminal: terminal(true) }),
        CeilingRaiseReasonRequired,
      );
    }
    await assert.rejects(
      raiseCommand({
        attemptDir: dir, calls: 1, terminal: terminal(true),
        reason: "raising for sk-ant-api03-0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop",
      }),
      CeilingRaiseCredentialRejected,
    );
    assert.deepEqual(grants(dir), []);
  });
});

test("a grant is a whole number of calls, at least one and at most the per-act bound", async () => {
  await withRoot("bounded-act", async (root) => {
    const dir = await attempt(root, "bounded-act");
    for (const calls of [0, -1, 1.5, MAX_GRANT_CALLS + 1, Number.NaN]) {
      await assert.rejects(
        raiseCommand({ attemptDir: dir, calls, reason: REASON, terminal: terminal(true) }),
        CeilingRaiseInvalid,
        `${calls} is not a grant`,
      );
    }
    assert.equal((await readAttempt(dir)).budget.ceiling, 5, "nothing moved");
  });
});

test("a raise is journalled with the owner's reason, and the ceiling moves by exactly the grant", async () => {
  await withRoot("journalled", async (root) => {
    const dir = await attempt(root, "journalled-raise");
    const lines: string[] = [];
    const result = await raiseCommand({
      attemptDir: dir, calls: 2, reason: `  ${REASON}  `,
      terminal: terminal(true, true, lines), now: () => AT,
    });

    assert.equal(result.confirmed, true);
    assert.equal(result.ceiling, 7);
    assert.equal(result.status.budget.ceiling, 7);
    assert.equal(result.status.lifecycleState, "DRAFT", "a raise moves no lifecycle edge");
    assert.deepEqual(result.status.ceilingGrants, [
      { calls: 2, ceiling: 7, reason: REASON, attempt: 1, at: AT },
    ]);

    // The journal — not merely the status — carries the grant and the reason.
    const recorded = grants(dir);
    assert.equal(recorded.length, 1);
    assert.deepEqual(recorded[0], {
      type: "ceiling-grant", calls: 2, from: 5, to: 7, reason: REASON, attempt: 1, at: AT,
    });

    // The screen states the act before it is taken, including that no config
    // file is edited — the one property the whole design turns on.
    const screen = lines.join("\n");
    assert.match(screen, /Raise: 5 -> 7 \(\+2\)/);
    assert.match(screen, new RegExp(`Reason on record: ${REASON}`));
    assert.match(screen, /awsf\.config\.yaml is not edited/);
    assert.match(screen, /widens no other task/);

    const shown = await statusCommand(dir);
    assert.ok(shown.some((line) => /Calls: 0\/7 spent.*2 owner-granted by 1 raise\(s\)/.test(line)), shown.join("\n"));
  });
});

test("a declined confirmation records nothing", async () => {
  await withRoot("declined", async (root) => {
    const dir = await attempt(root, "declined-raise");
    const before = await readAttempt(dir);
    const result = await raiseCommand({ attemptDir: dir, calls: 1, reason: REASON, terminal: terminal(false) });
    assert.equal(result.confirmed, false);
    assert.equal(result.ceiling, 5, "the ceiling it reports is the one still in force");
    const after = await readAttempt(dir);
    assert.equal(after.revision, before.revision);
    assert.deepEqual(grants(dir), []);
  });
});

test("no sequence of grants carries a ceiling past the hard bound", async () => {
  await withRoot("hard-bound", async (root) => {
    const dir = await attempt(root, "hard-bound");
    let ceiling = 5;
    while (ceiling + MAX_GRANT_CALLS <= MAX_CALL_CEILING) {
      ceiling = (await raiseCommand({
        attemptDir: dir, calls: MAX_GRANT_CALLS, reason: REASON, terminal: terminal(true),
      })).ceiling;
    }
    const remaining = MAX_CALL_CEILING - ceiling;
    if (remaining > 0) {
      ceiling = (await raiseCommand({
        attemptDir: dir, calls: remaining, reason: REASON, terminal: terminal(true),
      })).ceiling;
    }
    assert.equal(ceiling, MAX_CALL_CEILING);
    await assert.rejects(
      raiseCommand({ attemptDir: dir, calls: 1, reason: REASON, terminal: terminal(true) }),
      CeilingRaiseBeyondBound,
      "the ceiling can be raised and can never be removed",
    );
    assert.equal((await readAttempt(dir)).budget.ceiling, MAX_CALL_CEILING);
  });
});

test("a grant for one task never widens another", async () => {
  await withRoot("task-scoped", async (root) => {
    const raised = await attempt(root, "scoped-raised");
    const untouched = await attempt(root, "scoped-untouched");
    await raiseCommand({ attemptDir: raised, calls: 3, reason: REASON, terminal: terminal(true) });
    assert.equal((await readAttempt(raised)).budget.ceiling, 8);
    const other = await readAttempt(untouched);
    assert.equal(other.budget.ceiling, 5, "a sibling task keeps its configured ceiling");
    assert.deepEqual(other.ceilingGrants, []);
    assert.deepEqual(grants(untouched), []);
  });
});

test("a terminal attempt is refused, and retry carries the grants to the one that follows", async () => {
  await withRoot("terminal", async (root) => {
    const stateRoot = join(root, "state");
    const dir = await attempt(root, "carried-grants");
    await raiseCommand({ attemptDir: dir, calls: 2, reason: REASON, terminal: terminal(true), now: () => AT });

    const live = await readAttempt(dir);
    await persistAttempt(dir, live.revision, {
      kind: "attempt.transitioned",
      next: nextRevision(live, {
        lifecycleState: "CANCELLED",
        budget: { ...live.budget, callsSpent: 4 },
      }),
    });
    await assert.rejects(
      raiseCommand({ attemptDir: dir, calls: 1, reason: REASON, terminal: terminal(true) }),
      CeilingRaiseAttemptNotLive,
    );

    // Attempt 2 re-reads the CONFIGURED ceiling and re-applies the grants: it
    // inherits the spend the raise paid for, so it must inherit the raise.
    const retried = await retryCommand({
      attemptDir: dir, stateRoot, configSnapshotJson: "{}",
      allowance: { auto: 1, owner: 1 },
      callCeilings: callCeilingsOf({ T0: 1, T1: 3, T2: 6 }),
    });
    assert.equal(retried.status.budget.ceiling, 8, "6 configured + 2 granted");
    assert.equal(retried.status.budget.callsSpent, 4);
    assert.deepEqual(retried.status.ceilingGrants.map((grant) => grant.calls), [2]);
  });
});

test("the CLI wires the act: `awsf raise <task> --calls n --reason ...`", async () => {
  await withRoot("cli", async (root) => {
    const stateRoot = join(root, "state");
    const dir = await attempt(root, "cli-raise");
    const out: string[] = [];
    const err: string[] = [];
    const code = await main({
      argv: ["raise", "cli-raise", "--calls", "2", "--reason", REASON, "--state-root", stateRoot],
      cwd: resolve("."),
      terminal: terminal(true),
      writeOut: (line) => { out.push(line); },
      writeError: (line) => { err.push(line); },
    });
    // This fixture mints the attempt without a dashboard projection, so the
    // CLI's projector legitimately reports a missing session row. Everything
    // else on stderr would be a defect in the act itself.
    assert.deepEqual(err.filter((line) => !line.startsWith("sqlite-projection-failed:")), []);
    assert.equal(code, 0);
    assert.match(out.join("\n"), /Ceiling raised to 7 call\(s\) for cli-raise/);
    assert.equal((await readAttempt(dir)).budget.ceiling, 7);

    // A reason is not optional at the CLI boundary either, and the refusal
    // costs nothing.
    const refusal: string[] = [];
    assert.equal(await main({
      argv: ["raise", "cli-raise", "--calls", "1", "--reason", "  ", "--state-root", stateRoot],
      cwd: resolve("."), terminal: terminal(true),
      writeOut: () => {}, writeError: (line) => { refusal.push(line); },
    }), 1);
    assert.match(refusal.join("\n"), /usage: awsf raise/);
    assert.equal((await readAttempt(dir)).budget.ceiling, 7);
  });
});

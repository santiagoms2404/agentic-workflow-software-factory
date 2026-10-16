import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AttemptStatus } from "../../src/cli/commands/attempt.ts";
import { shiftReadout } from "../../src/cli/commands/shift-readout.ts";
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { git } from "../fixtures/seeded-continuation.ts";

// B6-02. `awsf status` gathers a shift's readout long after the run compiled
// its recipe. Invariant 12 flips each landed ticket's `state:` in the landing
// commit, and the sealed digest covers every byte of the ticket file, so a
// readout that rebuilds from the canonical checkout refuses every landed shift.
// The readout rebuilds from the attempt's recorded base instead, the bytes the
// run compiled from, and still refuses a ticket whose base bytes are not the
// sealed ones. A real Git repository, because the base blobs are read through Git.

const PLAN = "fixture-readout-landed";
const IDS = ["T01", "T02"] as const;
const REFUSED = "the recipe cannot be rebuilt from the recorded selection";

const ticketSource = (id: string): string => [
  "---", `id: ${id}`, `title: "Ticket ${id}"`, "milestone: M1", "state: todo", "depends_on: []", "---",
  `# ${id} · Ticket ${id}`, "", "## Handoff", "", "_Empty._", "", "## Build prompt", "", "```", `TASK ${id}.`, "```", "",
].join("\n");

const commit = (root: string, message: string): string => {
  git(root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-am", message);
  return git(root, "rev-parse", "HEAD");
};

/**
 * A shift selected over two tickets committed at its base. `committed` rewrites
 * a ticket's bytes before the base commit, after the manifest sealed them, so
 * the base itself holds bytes the selection never named.
 */
function shiftWorld(committed: (id: string, source: string) => string = (_id, source) => source): {
  root: string; attemptDir: string; status: AttemptStatus; path: (id: string) => string;
} {
  const root = mkdtempSync(join(tmpdir(), "awsf-readout-landed-"));
  const attemptDir = mkdtempSync(join(tmpdir(), "awsf-readout-attempt-"));
  git(tmpdir(), "init", "--quiet", "-b", "main", root);
  mkdirSync(join(root, "specs", "tickets", PLAN), { recursive: true });
  const path = (id: string) => join(root, "specs", "tickets", PLAN, `${id}.md`);
  const tickets = IDS.map((id) => {
    const source = ticketSource(id);
    writeFileSync(path(id), committed(id, source));
    return { id, path: `specs/tickets/${PLAN}/${id}.md`, digest: ticketFileDigest(Buffer.from(source)) };
  });
  git(root, "add", ".");
  git(root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "test: select a shift's tickets");
  const status = {
    schema: "awsf/attempt-status/v1", project: "fixture-project", taskId: "landed-shift", attempt: 1, workflow: "shift",
    repository: root, lifecycleState: "LANDED", baseSha: git(root, "rev-parse", "HEAD"), candidateSha: null,
    shift: sealShiftManifest({ plan: PLAN, milestones: ["M1"], tickets }), recovery: null, blocker: null,
  } as unknown as AttemptStatus;
  return { root, attemptDir, status, path };
}

/** The landing commit's bookkeeping: every selected ticket's state flips to done (invariant 12). */
function land(root: string, path: (id: string) => string): string {
  for (const id of IDS) writeFileSync(path(id), readFileSync(path(id), "utf8").replace("state: todo", "state: done"));
  return commit(root, "chore(plan): land the shift's tickets");
}

function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

test("a landed shift still lists its ticket rows: the recipe is rebuilt from the recorded base, not the flipped checkout", async () => {
  const { root, attemptDir, status, path } = shiftWorld();
  try {
    const before = await shiftReadout(status, [], attemptDir);
    const landedHead = land(root, path);
    assert.notEqual(landedHead, status.baseSha);
    const after = await shiftReadout(status, [], attemptDir);
    assert.ok(!after.some((line) => line.includes(REFUSED)), after.join("\n"));
    assert.deepEqual(after.slice(1, 3), ["  T01  Ticket T01  -------  not run", "  T02  Ticket T02  -------  not run"]);
    assert.deepEqual(after, before, "landing changes nothing the readout reports");
  } finally {
    cleanup(root, attemptDir);
  }
});

test("a ticket whose bytes at the recorded base are not the sealed ones is still refused by digest", async () => {
  const { root, attemptDir, status, path } = shiftWorld((id, source) => id === "T02" ? source.replace("TASK T02.", "TASK T02, rewritten.") : source);
  try {
    // The checkout holds the sealed bytes again, uncommitted; the base does not, and the base is what is read.
    writeFileSync(path("T02"), ticketSource("T02"));
    const lines = await shiftReadout(status, [], attemptDir);
    assert.match(lines[1] ?? "", /^ {2}the recipe cannot be rebuilt from the recorded selection: ticket T02 changed since selection: manifest digest [0-9a-f]{64}, supplied bytes [0-9a-f]{64}$/u);
    assert.ok(!lines.some((line) => line.startsWith("  T01  ")), lines.join("\n"));
  } finally {
    cleanup(root, attemptDir);
  }
});

test("an unlanded shift reads as before: its base is HEAD, and with no base recorded the checkout is the source", async () => {
  const { root, attemptDir, status, path } = shiftWorld();
  try {
    const rows = ["  T01  Ticket T01  -------  not run", "  T02  Ticket T02  -------  not run"];
    assert.deepEqual((await shiftReadout(status, [], attemptDir)).slice(1, 3), rows);
    const unstarted = { ...status, lifecycleState: "DRAFT", baseSha: null } as AttemptStatus;
    assert.deepEqual((await shiftReadout(unstarted, [], attemptDir)).slice(1, 3), rows);
    // With no base to read, the checkout is what a start would compile, so an edit there is refused there.
    writeFileSync(path("T01"), readFileSync(path("T01"), "utf8").replace("_Empty._", "edited before start"));
    assert.match((await shiftReadout(unstarted, [], attemptDir))[1] ?? "", /^ {2}the recipe cannot be rebuilt from the recorded selection: ticket T01 changed since selection: /u);
  } finally {
    cleanup(root, attemptDir);
  }
});

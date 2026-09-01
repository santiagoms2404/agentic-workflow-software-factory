import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { queryBacklog } from "../../src/backlog.ts";
import type { IntakeOutput } from "../../src/contracts/intake-output.ts";
import { parseEnvelope } from "../../src/contracts/parse-envelope.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { runStubCommand } from "../../src/cli/commands/run.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { TicketStore } from "../../src/persistence/ticket-store.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

test("vague intent becomes a ready ticket that drives a zero-spend stub run", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-work-intake-"));
  const repository = join(root, "canonical");
  const stateRoot = join(root, "state");
  const worktreeRoot = join(root, "worktrees");
  try {
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    writeFileSync(join(repository, "README.md"), "fixture repository\n");
    const configPath = join(repository, "awsf.config.yaml");
    writeFileSync(
      configPath,
      readFileSync(resolve("awsf.config.yaml"), "utf8").replace("seed_paths: [node_modules]", "seed_paths: []"),
    );
    git(repository, "add", "README.md", "awsf.config.yaml");
    git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed work intake journey");

    const vagueIntent = "make release notes easier";
    const intake: IntakeOutput = {
      schema: "awsf.intake-output/v1",
      producerStatus: "success",
      summary: "Turned one-line intent into bounded work.",
      artifacts: [{ path: "specs/tickets/T37.md", kind: "documentation", description: "Validated work ticket." }],
      notesForNextPhase: "Run the ready ticket without retyping its acceptance criteria.",
      ticket: {
        id: "T37",
        title: "Generate release notes from landed changes",
        milestone: "M11",
        tier: 2,
        state: "todo",
        depends_on: [],
        workflow: "simple-sdlc",
        outcome: "Landed changes produce a concise release-note draft.",
        context: [`Owner intent: ${vagueIntent}.`],
        acceptance: ["A stub run reaches AWAITING_OWNER with an exact candidate revision."],
        non_goals: ["Publishing the release notes."],
      },
    };
    const parsed = parseEnvelope(JSON.stringify(intake), "awsf.intake-output/v1");
    assert.equal(parsed.valid, true);
    if (!parsed.valid) return;

    const store = new TicketStore(join(repository, "specs", "tickets"));
    await store.write(parsed.payload.ticket, "# T37 — Generate release notes from landed changes\n");
    const [record] = await store.load();
    assert.equal(record?.ticket?.acceptance.length, 1);
    const backlog = await queryBacklog(store, []);
    assert.deepEqual(backlog.ready.map((ticket) => ticket.id), ["T37"]);

    git(repository, "add", "specs/tickets/T37.md");
    git(repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: accept refined fixture ticket");
    const ticket = backlog.ready[0]!;
    const created = await newCommand({
      stateRoot,
      project: "agentic-workflow-software-factory",
      taskId: ticket.id,
      repository,
      request: ticket.outcome,
      workflow: ticket.workflow,
      tier: ticket.tier,
    });
    await startCommand({
      attemptDir: created.attemptDir,
      worktreeRoot,
      configPath,
      preflight: () => ({ adapter: true, sandbox: true, observability: true }),
    });
    const status = await runStubCommand(created.attemptDir);
    assert.equal(status.lifecycleState, "AWAITING_OWNER");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.ok(status.candidateSha);
    assert.equal(git(repository, "rev-parse", "HEAD") === status.candidateSha, false, "the stub candidate still waits for the owner gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AwsfConfig, AdapterEntry } from "../../src/config/schema.ts";
import { loadConfig } from "../../src/config/load.ts";
import { PiCodexAdapter } from "../../src/adapters/pi-codex.ts";
import { createApiRouter } from "../../src/api/routes.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { DocumentOutput } from "../../src/contracts/document-output.ts";
import type { IntakeOutput } from "../../src/contracts/intake-output.ts";
import type { PlanOutput } from "../../src/contracts/plan-output.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import type { ScoutOutput } from "../../src/contracts/scout-output.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type {
  Availability,
  BrokerProcessRegistration,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ProcessSpec,
  ProcessTransport,
  TransportBroker,
} from "../../src/adapters/interface.ts";
import { AdapterError, isTaskEdgeRegistration, reservationIdOf } from "../../src/adapters/interface.ts";
import { ProcessTransportBroker, runSystemCommand, type BrokerOptions } from "../../src/execution/transport-broker.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { main as cliMain } from "../../src/cli/main.ts";
import { assertNoExecutionController } from "../../src/execution/operation-lease.ts";
import { grantCommand } from "../../src/cli/commands/grant.ts";
import { journeyCommand } from "../../src/cli/commands/journey.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { readProtectedState, inspectProtectedCandidate } from "../../src/workflow/protected-grants.ts";
import { stagedIndexBytes } from "../../src/git/protected-reconcile.ts";
import { raiseCommand } from "../../src/cli/commands/raise.ts";
import { correctionHeadroom } from "../../src/cli/commands/workflows.ts";
import { WORKFLOW_RECIPES, workflowRecipe } from "../../src/workflow/catalog.ts";
import { writePlacement } from "../../src/registry/placement.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { statusCommand } from "../../src/cli/commands/status.ts";
import { runProductionCommand, resumeProductionCommand, ProductionConfigSnapshotMismatch, ProductionWorkflowUnsupported } from "../../src/cli/commands/production-run.ts";
import type { PhaseRouteOverrides } from "../../src/workflow/route-flags.ts";
import { nextRevision, persistAttempt, readAttempt, type AttemptProjector } from "../../src/cli/commands/attempt.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import { agentsForSession, gatesForSession, getSession, phasesForSession, pollEvents, processesForSession } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { TicketStore } from "../../src/persistence/ticket-store.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

const RESUME_INSTRUCTION = '  Report this café instruction verbatim in implementationNotes.\n"Keep existing write limits."  ';
for (const scenario of ["success", "planner-open-question-once"] as const) {
for (const { instruction, corrupt, routed, granted = false } of [{ instruction: undefined, corrupt: false, routed: false }, { instruction: RESUME_INSTRUCTION, corrupt: false, routed: false }, { instruction: RESUME_INSTRUCTION, corrupt: true, routed: false }, { instruction: RESUME_INSTRUCTION, corrupt: false, routed: true }, { instruction: RESUME_INSTRUCTION, corrupt: false, routed: false, granted: true }]) {
test(`O1 ${granted ? "A2 grant " : ""}${routed ? "selected-route " : ""}${scenario} ${instruction === undefined ? "original input" : corrupt ? "substituted input refused" : "supplemented input"}: quota anchor survives refusal and resumes exactly one unstarted builder under a controller lease`, async () => {
  const world = await fixture("plan-build-test", 0, config => ({ ...config,
    adapters: { ...config.adapters, ...(routed ? { secondary: config.adapters.codex! } : {}) },
    ...(granted ? { policy: { ...config.policy, protected_paths: [...config.policy.protected_paths, "core/src/generated.ts"] } } : {}),
    routing: { ...config.routing, quota_stop: { default: { minutes: 30, probe_timeout_ms: 1000 } } } }), 1,
    "write one bounded source", () => {}, routed ? { builder: { adapter: "secondary", provider: "openai-codex", effort: "low" } } : {});
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    if (granted) await grantCommand({ attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath, stateRoot: world.stateRoot,
      phase: "builder", files: ["core/src/generated.ts"], reason: "Authorize one phase after quota readmission.", sandboxProbe: () => true,
      terminal: { interactive: true, write: () => {}, confirm: async () => true } });
    let mode: "low" | "healthy" | "unknown" = "low";
    let launched = 0;
    const actualInputs: string[] = [];
    const readyIndices = new Map<string, Buffer>();
    const completedCalls = scenario === "success" ? 1 : 2;
    let probes = 0;
    const options = { attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
      ...(instruction === undefined ? {} : { instruction }),
      projectRecord: (async (record, current) => {
        if (record.event.evidence?.type === "phase-result-ready" && record.event.evidence.checkpoint.pending?.phaseKey === "builder") {
          readyIndices.set(record.event.evidence.checkpoint.id, readFileSync(git(current.worktree!, "rev-parse", "--path-format=absolute", "--git-path", "index")));
        }
      }) satisfies AttemptProjector,
      infrastructure: { adapterFor: (_entry: AdapterEntry, id: string) => new class extends ScriptedAdapter {
        override buildSpec(request: ModelRequest): ProcessSpec {
          const spec = super.buildSpec(request);
          return corrupt && request.prompt.includes("Owner supplemental instruction") ? { ...spec, stdin: request.prompt + "\nsubstituted" } : spec;
        }
      }(id === "secondary" ? "codex" : id, prepared.worktree!, request => { launched++; if (routed && !request.model.startsWith("claude:")) assert.equal(request.effort, "low"); }, scenario),
        createBroker: (brokerOptions: BrokerOptions): TransportBroker => {
          const delegate = fakeBroker(brokerOptions);
          return { startProcess: (registration, spec, signal) => { actualInputs.push(spec.stdin ?? ""); return delegate.startProcess(registration, spec, signal); } };
        }, sandboxProbe: () => granted, now: () => "2026-08-24T20:26:39.429Z",
        resolveExecutable: () => "/fixture/quota-axi",
        runCommand: ((executable, argv, opts) => {
          if (executable !== "/fixture/quota-axi") return runSystemCommand(executable, argv, opts);
          if (argv[0] === "--version") return { status: 0, stdout: "quota-axi 0.1.29", stderr: "", error: null };
          probes++;
          const data = JSON.parse(readFileSync(resolve("core/test/fixtures/quota-axi/nominal.json"), "utf8"));
          if (mode === "low") data.providers[1].windows[0].resetsAt = "2026-08-24T20:27:39.429Z";
          if (mode === "unknown") data.providers[1].state = { status: "stale", stale: true };
          return { status: 0, stdout: JSON.stringify(data), stderr: "", error: null };
        }) satisfies typeof runSystemCommand },
    };
    const paused = await runProductionCommand(options);
    assert.equal(paused.lifecycleState, "RUNNING", paused.blocker?.detail);
    assert.equal(paused.recovery?.kind, "quota-pause");
    if (granted) assert.equal(readProtectedState(world.created.attemptDir).consumptions.length, 0, "quota refusal never consumes an unstarted grant");
    if (routed) assert.equal(paused.recovery.quota?.adapterId, "secondary");
    assert.deepEqual(paused.recovery?.prefix.map(entry => entry.phaseKey), ["request", "planner"]);
    assert.equal(paused.budget.callsSpent, completedCalls);
    assert.equal(paused.budget.callsReserved, 0);
    assert.equal(paused.recovery?.prefix.at(-1)?.round, completedCalls - 1);
    assert.equal(launched, completedCalls);
    const display: string[] = [];
    const terminal = { interactive: true, write: (line: string) => { display.push(line); }, confirm: async () => true };
    if (completedCalls === 2) await assert.rejects(resumeProductionCommand({ ...options, reason: "quota recovered", terminal }), /already committed/);
    await raiseCommand({ attemptDir: options.attemptDir, calls: 1, reason: "fund remaining phase headroom", terminal });
    const original = readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8");
    if (routed) {
      const stable = await readAttempt(options.attemptDir);
      await persistAttempt(options.attemptDir, stable.revision, { kind: "attempt.updated", next: nextRevision(stable, {
        routeOverrides: { builder: { ...stable.routeOverrides.builder, effort: "high" } },
      }) });
      await assert.rejects(resumeProductionCommand({ ...options, reason: "route changed", terminal }), /configuration.*changed/);
      writeFileSync(join(options.attemptDir, "journal.jsonl"), original);
      writeFileSync(join(options.attemptDir, "status.json"), JSON.stringify(stable));
    }
    await assert.rejects(runProductionCommand(options), /use awsf resume/);
    for (const bad of ["", "   ", "x".repeat(16_385)]) await assert.rejects(resumeProductionCommand({ ...options, instruction: bad, reason: "quota recovered", terminal }), /owner instruction/);
    await assert.rejects(resumeProductionCommand({ ...options, reason: "quota recovered", terminal }), /quota.*below/);
    mode = "unknown";
    await assert.rejects(resumeProductionCommand({ ...options, reason: "quota recovered", terminal }), /quota.*unknown/);
    mode = "healthy";
    await assert.rejects(resumeProductionCommand({ ...options, reason: "quota recovered", terminal: { ...terminal, interactive: false } }), /TTY/);
    await assert.rejects(resumeProductionCommand({ ...options, reason: "quota recovered", terminal: {
      ...terminal, confirm: async () => { mode = "low"; return true; } } }), /quota.*below/);
    mode = "healthy";
    const declined = await resumeProductionCommand({ ...options, reason: "quota recovered", terminal: { ...terminal, confirm: async () => false } });
    assert.equal(declined.confirmed, false);
    assert.equal(readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8"), original);
    writeFileSync(join(prepared.worktree!, "unapproved.txt"), "retain this\n");
    await assert.rejects(resumeProductionCommand({ ...options, reason: "quota recovered", terminal }), /not clean/);
    assert.equal(readFileSync(join(prepared.worktree!, "unapproved.txt"), "utf8"), "retain this\n");
    rmSync(join(prepared.worktree!, "unapproved.txt"));
    const changed = structuredClone(world.config);
    changed.agents[0]!.thinking = "low";
    await assert.rejects(resumeProductionCommand({ ...options, config: changed, reason: "quota recovered", terminal }), /configuration/);
    if (instruction !== undefined && !corrupt) {
      await assert.rejects(resumeProductionCommand({ ...options, reason: "quota recovered", terminal: { ...terminal, confirm: async () => {
        await raiseCommand({ attemptDir: options.attemptDir, calls: 1, reason: "a separate owner act changes the anchor revision", terminal });
        return true;
      } } }), /anchor changed/);
      assert.equal(launched, completedCalls);
      assert.ok(!readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8").includes('"type":"resume-activation"'));
    }
    if (corrupt) {
      const rejected = await resumeProductionCommand({ ...options, reason: "quota recovered", terminal });
      assert.equal(rejected.status.lifecycleState, "BLOCKED");
      assert.match(rejected.status.blocker?.detail ?? "", /resume instruction differs from actual adapter input/);
      assert.equal(rejected.status.budget.callsSpent, completedCalls);
      assert.equal(rejected.status.budget.callsReserved, 0);
      assert.equal(launched, completedCalls);
      assert.equal(actualInputs.length, completedCalls);
      return;
    }
    const before = probes;
    const contenders = await Promise.allSettled([1, 2].map(() => resumeProductionCommand({ ...options, reason: "quota recovered", terminal })));
    assert.equal(contenders.filter(result => result.status === "fulfilled").length, 1, JSON.stringify(contenders));
    const resumed = await readAttempt(options.attemptDir);
    assert.equal(resumed.lifecycleState, "AWAITING_OWNER", resumed.blocker?.detail);
    assert.equal(resumed.budget.callsSpent, completedCalls + 1);
    assert.equal(resumed.budget.callsReserved, 0);
    assert.equal(resumed.recovery?.prefix.find(entry => entry.phaseKey === "planner")?.round, completedCalls - 1);
    assert.equal(launched, completedCalls + 1);
    assert.ok(probes - before >= 2);
    assert.equal(resumed.request, prepared.request);
    const history = readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8");
    const evidence = history.trim().split("\n").map(line => JSON.parse(line).event.evidence);
    const activations = evidence.filter(event => event?.type === "resume-activation");
    assert.equal(activations.length, 1);
    const commitment = activations[0].ownerInstruction;
    if (instruction === undefined) {
      assert.equal(commitment, undefined);
      assert.ok(actualInputs.every(input => !input.includes("Owner supplemental instruction")));
    } else {
      assert.equal(commitment.amendment.text, instruction);
      assert.ok(display.some(line => line.includes("Supplement recipient: builder") && line.includes(JSON.stringify(instruction))));
      assert.equal(actualInputs.at(-1)!.split(JSON.stringify(instruction)).length - 1, 1);
      assert.ok(actualInputs.slice(0, -1).every(input => !input.includes(JSON.stringify(instruction))));
      assert.deepEqual(evidence.filter(event => event?.type === "resume-instruction-delivery").map(event => event.delivery.state), ["intent", "submitted"]);
      assert.equal(resumed.recovery?.prefix.find(entry => entry.phaseKey === "builder")?.ownerAmendmentDigest, commitment.amendment.digest);
      const built = evidence.find(event => event?.type === "envelope" && event.envelope.schemaId === "awsf.build-output/v1");
      assert.ok(built.envelope.payload.implementationNotes.includes(instruction));
    }
    const replay = await resumeProductionCommand({ ...options, reason: "quota recovered", terminal });
    assert.equal(replay.status.revision, resumed.revision);
    assert.equal(readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8"), history);
    assert.equal(launched, completedCalls + 1);
    if (granted) {
      const facts = readProtectedState(world.created.attemptDir);
      assert.equal(facts.consumptions.length, 1); assert.equal(facts.bindings.length, 1);
      assert.equal(activations[0].protectedConsumption.grantDigest, facts.grants[0]!.digest);
      assert.equal(activations[0].reservationId, facts.consumptions[0]!.reservationId);
      return;
    }
    if (instruction !== undefined) {
      const lines: string[] = [];
      const cli = { argv: ["resume", resumed.taskId, "--reason", "verify applied instruction", "--instruction", instruction,
        "--config", world.configPath, "--state-root", world.stateRoot], cwd: world.canonical,
        writeOut: (line: string) => lines.push(line), writeError: (line: string) => lines.push(line),
        terminal: { ...terminal, confirm: async () => assert.fail("completed instruction must not be sent again") } };
      assert.equal(await cliMain(cli), 0, lines.join("\n"));
      assert.equal(await cliMain({ ...cli, argv: [...cli.argv, "--instruction", "different instruction"] }), 1);
      assert.equal(readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8"), history);
      const rows = history.trim().split("\n").map(line => JSON.parse(line));
      const cut = rows.findLastIndex(row => row.event.evidence?.type === "phase-result-ready" && row.event.evidence.checkpoint.pending?.phaseKey === "builder");
      assert.ok(cut > 0);
      const anchor = rows[cut].event.next;
      git(prepared.worktree!, "reset", "--mixed", anchor.recovery.worktreeHeadSha);
      writeFileSync(git(prepared.worktree!, "rev-parse", "--path-format=absolute", "--git-path", "index"), readyIndices.get(anchor.recovery.id)!);
      rmSync(join(options.attemptDir, "envelopes", "tests-0.json"));
      writeFileSync(join(options.attemptDir, "journal.jsonl"), rows.slice(0, cut + 1).map(row => JSON.stringify(row)).join("\n") + "\n");
      writeFileSync(join(options.attemptDir, "status.json"), JSON.stringify(rows[cut - 1].event.next));
      const { instruction: _instruction, ...validationOptions } = options;
      const validated = await resumeProductionCommand({ ...validationOptions, reason: "validate the already amended reply", terminal,
        infrastructure: { ...options.infrastructure, adapterFor: () => assert.fail("amended reply must not call its adapter again"),
          createBroker: () => assert.fail("amended reply must not open a broker again") } });
      assert.equal(validated.status.lifecycleState, "AWAITING_OWNER", validated.status.blocker?.detail);
      assert.equal(validated.status.budget.callsSpent, completedCalls + 1);
      const completed = readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8");
      assert.equal(completed.split('"type":"resume-instruction-delivery"').length - 1, 2);
      assert.equal(launched, completedCalls + 1);
    }
  } finally { world.projection.close(); rmSync(world.root, { recursive: true, force: true }); }
});
}
}

for (const workflow of ["plan", "build", "build-review"] as const) {
  test(`O2 ${workflow} replays a durable accepted result after a journal/status crash without another model call`, async () => {
    const world = await fixture(workflow, 0, config => config, workflow === "plan" ? 0 : workflow === "build-review" ? 2 : 1);
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      let launched = 0;
      const options = { attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
        infrastructure: { adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => { launched++; }),
          createBroker: fakeBroker, sandboxProbe: () => false } };
      const completed = await runProductionCommand(options);
      assert.equal(completed.lifecycleState, "AWAITING_OWNER", completed.blocker?.detail);
      const expectedCalls = launched;
      const journalPath = join(options.attemptDir, "journal.jsonl");
      const records = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
      const phase = workflow === "build" ? "builder" : workflow === "plan" ? "planner" : "reviewer";
      const cut = records.findLastIndex(record => record.event.evidence?.type === "phase-accepted" && record.event.evidence.phase.key === phase);
      assert.ok(cut > 0);
      // Only this isolated fixture is cut. The durable journal contains completion,
      // while status retains the immediately preceding revision, as after fsync/rename loss.
      for (const later of workflowRecipe(workflow)!.phases.slice(records[cut].event.next.recovery.prefix.length)) {
        for (let round = 0; round <= later.maxCorrections; round++) rmSync(join(options.attemptDir, "envelopes", `${later.id}-${round}.json`), { force: true });
      }
      writeFileSync(journalPath, records.slice(0, cut + 1).map(record => JSON.stringify(record)).join("\n") + "\n");
      writeFileSync(join(options.attemptDir, "status.json"), JSON.stringify(records[cut - 1].event.next));
      const sha = git(prepared.worktree!, "rev-parse", "HEAD");
      const untouched = readFileSync(journalPath, "utf8");
      await assert.rejects(resumeProductionCommand({ ...options, instruction: RESUME_INSTRUCTION, reason: "no new step exists",
        terminal: { interactive: true, write: () => {}, confirm: async () => assert.fail("no model recipient") } }), /next unstarted phase.*model step/);
      assert.equal(readFileSync(journalPath, "utf8"), untouched);
      const result = await resumeProductionCommand({ ...options,
        infrastructure: { ...options.infrastructure, adapterFor: () => assert.fail("completed result must not reopen an adapter"), createBroker: () => assert.fail("completed result must not construct a provider broker") },
        reason: "finish durable result", terminal: {
        interactive: true, write: () => {}, confirm: async () => true } });
      assert.equal(result.status.lifecycleState, "AWAITING_OWNER", result.status.blocker?.detail);
      assert.equal(result.status.budget.callsSpent, completed.budget.callsSpent);
      assert.equal(result.status.budget.callsReserved, 0);
      assert.equal(launched, expectedCalls);
      assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), sha);
      assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
      if (workflow === "build-review") assert.equal(result.status.requiredReviewPresent, true);
      const stableJournal = readFileSync(journalPath, "utf8");
      const lines: string[] = [];
      const cli = { argv: ["resume", result.status.taskId, "--reason", "check recovered result", "--config", world.configPath, "--state-root", world.stateRoot],
        cwd: world.canonical, writeOut: (line: string) => lines.push(line), writeError: (line: string) => lines.push(line),
        terminal: { interactive: true, write: () => {}, confirm: async () => assert.fail("already complete must not reconfirm") } };
      assert.equal(await cliMain(cli), 0, lines.join("\n"));
      assert.equal(await cliMain({ ...cli, argv: [...cli.argv, "--stub"] }), 1);
      assert.equal(readFileSync(journalPath, "utf8"), stableJournal);
      assert.equal(launched, expectedCalls);
    } finally { world.projection.close(); rmSync(world.root, { recursive: true, force: true }); }
  });
}

test("resume supplements survive another quota pause and reach later review as immutable task intent", async () => {
  const world = await fixture("simple-sdlc", 0, config => ({ ...config, routing: { ...config.routing,
    quota_stop: { default: { minutes: 60, probe_timeout_ms: 500 } } } }), 2);
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    let low: "builder" | "documenter" | null = "builder";
    const prompts: string[] = [];
    const options = { attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement, assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, request => {
          prompts.push(request.prompt);
          if (!request.model.startsWith("claude:")) low = "documenter";
        }), createBroker: fakeBroker, sandboxProbe: () => false, now: () => "2026-08-24T20:26:39.429Z",
        resolveExecutable: (executable: string) => executable === "quota-axi" ? "/fixture/quota-axi" : executable,
        runCommand: ((executable, argv, opts) => {
          if (executable !== "/fixture/quota-axi") return runSystemCommand(executable, argv, opts);
          if (argv[0] === "--version") return { status: 0, stdout: "quota-axi 0.1.29", stderr: "", error: null };
          const data = JSON.parse(readFileSync(resolve("core/test/fixtures/quota-axi/nominal.json"), "utf8"));
          if (low !== null) for (const window of data.providers[low === "builder" ? 1 : 0].windows) window.resetsAt = "2026-08-24T20:27:39.429Z";
          return { status: 0, stdout: JSON.stringify(data), stderr: "", error: null };
        }) satisfies typeof runSystemCommand,
      } };
    assert.equal((await runProductionCommand(options)).recovery?.kind, "quota-pause");
    const terminal = { interactive: true, write: () => {}, confirm: async () => true };
    low = null;
    const call = { ...options, instruction: RESUME_INSTRUCTION, reason: "first confirmed reason", terminal: { ...terminal, confirm: async () => {
      call.instruction = "unconfirmed substitution";
      call.reason = "unconfirmed reason";
      return true;
    } } };
    const first = await resumeProductionCommand(call);
    assert.equal(first.status.recovery?.kind, "quota-pause", first.status.blocker?.detail);
    assert.equal(first.status.budget.callsSpent, 2);
    assert.ok(prompts[1]!.includes(JSON.stringify(RESUME_INSTRUCTION)));
    assert.ok(!prompts[1]!.includes("unconfirmed substitution"));
    low = null;
    const docInstruction = "Document only the verified bounded source.";
    const second = await resumeProductionCommand({ ...options, reason: "second confirmed reason", instruction: docInstruction, terminal });
    assert.equal(second.status.lifecycleState, "AWAITING_OWNER", second.status.blocker?.detail);
    assert.equal(second.status.requiredReviewPresent, true);
    assert.equal(second.status.budget.callsSpent, 4);
    assert.equal(second.status.budget.callsReserved, 0);
    assert.equal(second.status.request, prepared.request);
    assert.equal(prompts.length, 4);
    assert.ok(prompts[2]!.includes(JSON.stringify(docInstruction)));
    assert.ok(prompts[3]!.includes(JSON.stringify(RESUME_INSTRUCTION)));
    assert.ok(prompts[3]!.includes(docInstruction));
    assert.match(prompts[3]!, /historical task intent/);
    const journal = readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8");
    const evidence = journal.trim().split("\n").map(line => JSON.parse(line).event.evidence);
    const activations = evidence.filter(value => value?.type === "resume-activation");
    assert.deepEqual(activations.map(value => value.reason), ["first confirmed reason", "second confirmed reason"]);
    assert.deepEqual(activations.map(value => value.ownerInstruction.amendment.binding.phaseKey), ["builder", "documenter"]);
    assert.equal(evidence.filter(value => value?.type === "resume-instruction-delivery").length, 4);
    const replay = await resumeProductionCommand({ ...options, reason: "verify completed history", instruction: docInstruction, terminal });
    assert.equal(replay.status.revision, second.status.revision);
    assert.equal(readFileSync(join(options.attemptDir, "journal.jsonl"), "utf8"), journal);
    const report = readFileSync(join(dirname(options.attemptDir), "run-reports", "attempt-1-bounded-source.md"), "utf8");
    assert.ok(report.includes(JSON.stringify(RESUME_INSTRUCTION)));
    assert.ok(report.includes(JSON.stringify(docInstruction)));
  } finally { world.projection.close(); rmSync(world.root, { recursive: true, force: true }); }
});

for (const fault of ["none", "broker-uncertain", "after-submission"] as const) {
  test(`resume instruction targets an unstarted review: ${fault}`, async () => {
    const world = await fixture("build-review", 0, config => config, 2);
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const options = { attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
        infrastructure: { adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}), createBroker: fakeBroker, sandboxProbe: () => false } };
      assert.equal((await runProductionCommand(options)).lifecycleState, "AWAITING_OWNER");
      const journalPath = join(options.attemptDir, "journal.jsonl");
      const records = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
      const cut = records.findLastIndex(record => record.event.evidence?.type === "phase-accepted" && record.event.evidence.phase.key === "review-context");
      assert.ok(cut > 0);
      // Isolated crash fixture before L11. The completed builder, tests and candidate remain unchanged.
      writeFileSync(journalPath, records.slice(0, cut + 1).map(record => JSON.stringify(record)).join("\n") + "\n");
      writeFileSync(join(options.attemptDir, "status.json"), JSON.stringify(records[cut].event.next));
      rmSync(join(options.attemptDir, "envelopes", "reviewer-0.json"));
      let delegated = 0;
      const sha = git(prepared.worktree!, "rev-parse", "HEAD");
      const resume = { ...options, reason: "review has not started", instruction: "Check the generated source carefully without editing it.",
        terminal: { interactive: true, write: () => {}, confirm: async () => true }, infrastructure: { ...options.infrastructure,
          adapterFor: (_entry: AdapterEntry, id: string) => new class extends ScriptedAdapter {
            override async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration, signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
              if (fault === "after-submission") { await broker.startProcess(registration, this.buildSpec(request), signal); throw new AdapterError(id, "E_BACKEND_FAILURE", "reply acknowledgement lost"); }
              yield* super.execute(request, broker, registration, signal);
            }
          }(id, prepared.worktree!, () => {}),
          createBroker: (input: BrokerOptions): TransportBroker => {
            const delegate = fakeBroker(input);
            return { startProcess: (registration, spec, signal) => {
              delegated++;
              if (fault === "broker-uncertain") throw new AdapterError("fixture", "E_BACKEND_FAILURE", "broker lost launch acknowledgement");
              return delegate.startProcess(registration, spec, signal);
            } };
          },
        } };
      const result = await resumeProductionCommand(resume);
      assert.equal(delegated, 1, "an amended review cannot take a transport retry");
      assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), sha);
      assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
      assert.equal(result.status.budget.callsSpent, fault === "broker-uncertain" ? 1 : 2);
      assert.equal(result.status.budget.callsReserved, fault === "broker-uncertain" ? 1 : 0);
      const stable = readFileSync(journalPath, "utf8");
      if (fault === "none") {
        assert.equal(result.status.lifecycleState, "AWAITING_OWNER", result.status.blocker?.detail);
        assert.equal((await resumeProductionCommand(resume)).status.revision, result.status.revision);
      } else {
        assert.equal(result.status.lifecycleState, "BLOCKED", result.status.blocker?.detail);
        await assert.rejects(resumeProductionCommand(resume));
        const { instruction: _instruction, ...plainResume } = resume;
        await assert.rejects(resumeProductionCommand(plainResume));
      }
      assert.equal(readFileSync(journalPath, "utf8"), stable);
      assert.equal(delegated, 1);
    } finally { world.projection.close(); rmSync(world.root, { recursive: true, force: true }); }
  });
}

for (const sample of [
  { workflow: "scout", phase: "scout", tier: 0, scenario: "success" },
  { workflow: "plan", phase: "planner", tier: 0, scenario: "success" },
  { workflow: "plan", phase: "planner", tier: 0, scenario: "planner-open-question-once" },
  { workflow: "build", phase: "builder", tier: 1, scenario: "success" },
  { workflow: "build-review", phase: "reviewer", tier: 2, scenario: "success" },
  { workflow: "build", phase: "builder", tier: 1, scenario: "gate" },
] as const) {
  test(`F2 saved reply validation ${sample.workflow}/${sample.scenario} does not repeat the model call`, async () => {
    const world = await fixture(sample.workflow, 0, config => config, sample.tier);
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const indices = new Map<string, Buffer>();
      let launches = 0;
      const options = { attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
        projectRecord: (async (record, status) => {
          const evidence = record.event.evidence;
          if (evidence?.type === "phase-result-ready" && evidence.checkpoint.pending?.phaseKey === sample.phase) {
            indices.set(evidence.checkpoint.id, readFileSync(git(status.worktree!, "rev-parse", "--path-format=absolute", "--git-path", "index")));
          }
        }) satisfies AttemptProjector,
        infrastructure: { adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => { launches++; }, sample.scenario),
          createBroker: fakeBroker, sandboxProbe: () => false } };
      await runProductionCommand(options);
      const expectedLaunches = launches;
      const journalPath = join(options.attemptDir, "journal.jsonl");
      const records = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
      const cut = records.findLastIndex(record => record.event.evidence?.type === "phase-result-ready" && record.event.evidence.checkpoint.pending.phaseKey === sample.phase);
      assert.ok(cut >= 0, "a complete reply must have its own pre-validation checkpoint");
      const anchor = records[cut].event.next;
      for (const later of workflowRecipe(sample.workflow)!.phases.slice(anchor.recovery.prefix.length + 1)) {
        for (let round = 0; round <= later.maxCorrections; round++) rmSync(join(options.attemptDir, "envelopes", `${later.id}-${round}.json`), { force: true });
      }
      // Only this disposable fixture is rewound. Keep model-produced bytes and restore the exact pre-validation index.
      git(prepared.worktree!, "reset", "--mixed", anchor.recovery.worktreeHeadSha);
      writeFileSync(git(prepared.worktree!, "rev-parse", "--path-format=absolute", "--git-path", "index"), indices.get(anchor.recovery.id)!);
      writeFileSync(journalPath, records.slice(0, cut + 1).map(record => JSON.stringify(record)).join("\n") + "\n");
      writeFileSync(join(options.attemptDir, "status.json"), JSON.stringify(records[cut - 1].event.next));
      const resume = { ...options, reason: "validate the saved reply", terminal: { interactive: true, write: () => {}, confirm: async () => true },
        infrastructure: { ...options.infrastructure, adapterFor: () => assert.fail("saved reply must not reopen an adapter"),
          createBroker: () => assert.fail("saved reply must not construct a provider broker"), writeSystemPrompt: async () => assert.fail("saved reply needs no prompt materialization") } };
      const before = readFileSync(journalPath);
      const originalRecords = before.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
      for (const mutation of ["envelope", "route", "reservation", "phase", "exit", "liability"] as const) {
        const altered = structuredClone(originalRecords);
        const latest = altered.at(-1);
        if (mutation === "envelope") {
          const row = altered.find(record => record.event.evidence?.type === "envelope" && record.event.evidence.envelope.envelopeId === anchor.recovery.pending.envelopeId);
          row.event.evidence.envelope.payload.summary += " tampered";
        } else if (mutation === "exit") {
          const row = altered.findLast(record => record.event.evidence?.type === "process" && record.event.evidence.record.runId === anchor.recovery.pending.runId);
          row.event.evidence.exitCode = null;
        } else if (mutation === "liability") latest.event.next.budget.callsReserved = 1;
        else if (mutation === "phase") latest.event.evidence.phase.correctionCount += 1;
        else {
          const pending = latest.event.next.recovery.pending;
          if (mutation === "route") pending.model.provider = "another-provider";
          else pending.reservation.id = "another:original-call";
          latest.event.evidence.checkpoint = structuredClone(latest.event.next.recovery);
        }
        writeFileSync(journalPath, altered.map(record => JSON.stringify(record)).join("\n") + "\n");
        const changed = readFileSync(journalPath);
        await assert.rejects(resumeProductionCommand(resume), /saved reply|unsettled/);
        assert.deepEqual(readFileSync(journalPath), changed);
        assert.equal(launches, expectedLaunches);
      }
      writeFileSync(journalPath, before);
      const indexPath = git(prepared.worktree!, "rev-parse", "--path-format=absolute", "--git-path", "index");
      const indexBytes = readFileSync(indexPath);
      writeFileSync(indexPath, Buffer.concat([indexBytes, Buffer.from("changed index")]));
      await assert.rejects(resumeProductionCommand(resume), /worktree or index bytes changed/);
      assert.deepEqual(readFileSync(journalPath), before);
      writeFileSync(indexPath, indexBytes);
      const declined = await resumeProductionCommand({ ...resume, terminal: { ...resume.terminal, confirm: async () => false } });
      assert.equal(declined.confirmed, false);
      assert.deepEqual(readFileSync(journalPath), before);
      const extra = join(prepared.worktree!, "changed-after-reply.txt");
      writeFileSync(extra, "must be preserved on refusal\n");
      await assert.rejects(resumeProductionCommand(resume), /worktree or index bytes changed/);
      assert.equal(readFileSync(extra, "utf8"), "must be preserved on refusal\n");
      rmSync(extra);
      await assert.rejects(resumeProductionCommand({ ...resume, instruction: "cannot amend an already completed reply" }), /saved reply cannot receive/);
      assert.deepEqual(readFileSync(journalPath), before);
      const result = await resumeProductionCommand(resume);
      assert.equal(result.status.lifecycleState, sample.scenario === "gate" ? "BLOCKED" : "AWAITING_OWNER", result.status.blocker?.detail);
      assert.equal(result.status.budget.callsSpent, anchor.budget.callsSpent);
      assert.equal(result.status.budget.callsReserved, 0);
      assert.equal(launches, expectedLaunches);
      if (sample.scenario !== "gate") {
        const stable = readFileSync(journalPath);
        assert.equal((await resumeProductionCommand(resume)).status.revision, result.status.revision);
        assert.deepEqual(readFileSync(journalPath), stable);
      }
      const recovered = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
      // A3: host validation no longer clears the checkpoint. It advances it one
      // stage at a time, so a cut inside the read-only prefix is replayed from
      // durable evidence rather than refused. Cut at the first stage advance
      // this reply reached and restore the bytes that stage recorded.
      const started = recovered.findIndex((record, index) => index > cut && record.event.evidence?.type === "phase-validation-started");
      assert.ok(started > cut, "a saved reply must record the stage its host validation reached");
      assert.equal(recovered[started].event.next.recovery.kind, "validating");
      assert.equal(recovered[started].event.next.recovery.validation.stage, "envelope-check");
      assert.equal(recovered[started].event.evidence.checkpointId, anchor.recovery.id);
      for (const later of workflowRecipe(sample.workflow)!.phases.slice(anchor.recovery.prefix.length + 1)) {
        for (let round = 0; round <= later.maxCorrections; round++) rmSync(join(options.attemptDir, "envelopes", `${later.id}-${round}.json`), { force: true });
      }
      git(prepared.worktree!, "reset", "--mixed", anchor.recovery.worktreeHeadSha);
      writeFileSync(git(prepared.worktree!, "rev-parse", "--path-format=absolute", "--git-path", "index"), indices.get(anchor.recovery.id)!);
      writeFileSync(journalPath, recovered.slice(0, started + 1).map(record => JSON.stringify(record)).join("\n") + "\n");
      writeFileSync(join(options.attemptDir, "status.json"), JSON.stringify(recovered[started].event.next));
      const replayed = await resumeProductionCommand(resume);
      assert.equal(replayed.status.lifecycleState, sample.scenario === "gate" ? "BLOCKED" : "AWAITING_OWNER", replayed.status.blocker?.detail);
      assert.equal(replayed.status.budget.callsSpent, anchor.budget.callsSpent);
      assert.equal(replayed.status.budget.callsReserved, 0);
      assert.equal(launches, expectedLaunches, "replaying a read-only validation prefix must not reopen the provider");
    } finally { world.projection.close(); rmSync(world.root, { recursive: true, force: true }); }
  });
}

function plan(): PlanOutput {
  return {
    schema: "awsf.plan-output/v1", producerStatus: "success", summary: "write the bounded source",
    artifacts: [], notesForNextPhase: "write core/src/generated.ts", goals: ["write one source"],
    nonGoals: ["touch anything else"], implementationSteps: [{ id: "one", title: "write source", files: ["core/src/generated.ts"], acceptanceCriteria: ["configured command passes"] }],
    testStrategy: ["run configured command"], risks: [], openQuestions: [],
  };
}

function scout(): ScoutOutput {
  return {
    schema: "awsf.scout-output/v1",
    producerStatus: "success",
    summary: "observed the bounded source",
    artifacts: [],
    notesForNextPhase: "The owner can inspect the retained reconnaissance.",
    findings: [{ file: "README.md", note: "The repository contains the seeded source description." }],
  };
}

function intake(): IntakeOutput {
  return {
    schema: "awsf.intake-output/v1",
    producerStatus: "success",
    summary: "refined one bounded ticket",
    artifacts: [{ path: "specs/tickets/T99.md", kind: "documentation", description: "validated intake ticket" }],
    notesForNextPhase: "Inspect and land the ticket candidate.",
    ticket: {
      id: "T99",
      title: "Write one bounded source",
      milestone: "M1",
      tier: 1,
      state: "todo",
      depends_on: [],
      workflow: "build",
      outcome: "The bounded source exists.",
      context: ["The owner requested one bounded source."],
      acceptance: ["The configured command passes."],
      non_goals: ["Changing unrelated files."],
    },
  };
}

function document(): DocumentOutput {
  return {
    schema: "awsf.document-output/v1",
    producerStatus: "success",
    summary: "documented the bounded source",
    artifacts: [{ path: "README.md", kind: "documentation", description: "updated source note" }],
    notesForNextPhase: "Run the final host commands.",
    changedFiles: ["README.md"],
    documentedAreas: [{ subject: "bounded source", documentPath: "README.md" }],
    proposedCommitMessage: "docs: describe generated source",
    runReport: {
      path: "reports/bounded-source.md",
      markdown: "The bounded source was planned, built, and passed the configured host gate.",
    },
  };
}

function review(worktree: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1",
    producerStatus: "success",
    summary: "reviewed the exact candidate",
    artifacts: [],
    notesForNextPhase: "The owner decides.",
    verdict: "accept",
    reviewedSha: git(worktree, "rev-parse", "HEAD"),
    findings: [],
    limitations: [{ detail: "Scripted offline review.", affectedFiles: [] }],
  };
}

function build(path = "core/src/generated.ts"): BuildOutput {
  return {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote one source",
    artifacts: [{ path, kind: "source", description: "bounded source" }],
    notesForNextPhase: "run host commands", changedFiles: [path],
    implementationNotes: ["fixture implementation"], commandsRun: [], proposedCommitMessage: "feat: add generated source",
  };
}

type Scenario =
  | "success"
  | "malformed"
  | "permission"
  | "gate"
  | "hygiene"
  | "planner-open-question-once"
  | "planner-planned-artifact-once"
  | "documenter-noop";

class ScriptedAdapter implements HarnessAdapter {
  readonly id: string;
  readonly #worktree: string;
  readonly #onReleased: (request: ModelRequest) => void;
  readonly #scenario: Scenario;
  #turn = 0;
  constructor(id: string, worktree: string, onReleased: (request: ModelRequest) => void, scenario: Scenario = "success") { this.id = id; this.#worktree = worktree; this.#onReleased = onReleased; this.#scenario = scenario; }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model, contextWindow: null, supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration, signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    this.#onReleased(request);
    const at = "2026-08-11T00:00:00.000Z";
    const model = request.model;
    const turn = this.#turn++;
    let payload: PlanOutput | BuildOutput | DocumentOutput | IntakeOutput | ReviewOutput | ScoutOutput;
    if (request.prompt.includes("awsf.scout-output/v1")) payload = scout();
    else if (request.prompt.includes("awsf.intake-output/v1")) {
      payload = intake();
      await new TicketStore(join(this.#worktree, "specs", "tickets")).write(payload.ticket, "# T99 — Write one bounded source\n");
    } else if (request.prompt.includes("awsf.document-output/v1")) {
      payload = this.#scenario === "documenter-noop"
        ? { ...document(), artifacts: [], changedFiles: [], documentedAreas: [], proposedCommitMessage: "docs: no project documentation change" }
        : document();
      if (this.#scenario !== "documenter-noop") {
        writeFileSync(join(this.#worktree, "README.md"), "base\n\nThe generated source is host-verified.\n");
      }
    } else if (request.prompt.includes("awsf.review-output/v1")) payload = review(this.#worktree);
    else payload = model.startsWith("claude:") ? plan() : build();
    if (model.startsWith("claude:") && turn === 0 && this.#scenario === "planner-open-question-once") {
      payload = {
        ...plan(),
        notesForNextPhase: "The implementation decisions are recorded here.",
        openQuestions: ["None blocking. Decisions were made rather than asked and are recorded in notesForNextPhase."],
      };
    }
    if (model.startsWith("claude:") && turn === 0 && this.#scenario === "planner-planned-artifact-once") {
      payload = {
        ...plan(),
        artifacts: [{ path: "core/src/future-output.ts", kind: "source", description: "file the builder will create" }],
        implementationSteps: [{
          ...plan().implementationSteps[0]!,
          files: ["core/src/future-output.ts"],
        }],
      };
    }
    if (!model.startsWith("claude:")) {
      mkdirSync(join(this.#worktree, "core", "src"), { recursive: true });
      if (this.#scenario === "hygiene") {
        writeFileSync(join(this.#worktree, "core", "src", "generated.md"), "intentional Markdown break  \n");
        payload = build("core/src/generated.md");
      } else {
        writeFileSync(join(this.#worktree, "core", "src", "generated.ts"), "export const generated = true;\n");
      }
      if (this.#scenario === "permission") writeFileSync(join(this.#worktree, "outside.ts"), "breach\n");
      if (this.#scenario === "gate") payload = { ...build(), changedFiles: ["core/src/invented.ts"] };
    }
    if (payload.schema === "awsf.build-output/v1") {
      const supplement = /^Owner supplemental instruction[^\n]*:\n([^\n]*)/mu.exec(request.prompt);
      if (supplement !== null) payload = { ...payload, implementationNotes: [...payload.implementationNotes, JSON.parse(supplement[1]!)] };
    }
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, provider: this.id === "claude" ? "anthropic" : "openai-codex", requestedModel: model, resolvedModel: `${model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: this.#scenario === "malformed" ? "not-json" : JSON.stringify(payload) };
    yield { kind: "usage", seq: 4, runId: registration.runId, hostAt: at, providerAt: null, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

class CapturedPiAdapter extends PiCodexAdapter {
  readonly #fixtureMode: "success" | "parser-failure";
  readonly #liveMs: number;
  constructor(fixtureMode: "success" | "parser-failure" = "success", liveMs = 0) {
    super({ executable: "production-runner-fixture" });
    this.#fixtureMode = fixtureMode;
    this.#liveMs = liveMs;
  }
  override async isAvailable(): Promise<Availability> { return { status: "available" }; }
  override buildSpec(request: ModelRequest): ProcessSpec {
    const spec = super.buildSpec(request);
    return {
      ...spec,
      executable: CAPTURED_PROVIDER,
      argv: [...spec.argv, "--awsf-fixture-mode", this.#fixtureMode, "--awsf-fixture-live-ms", String(this.#liveMs)],
    };
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
        runId: registration.runId, edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
        ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId, phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role } } : {}),
        reservationId: reservationIdOf(registration), command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      await options.register(record);
      const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
      await options.onSpent?.(record, reservation);
      return {
        runId: registration.runId, identity: record.identity,
        stdout: (async function* () {})(), stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
      };
    },
  };
}

const CAPTURED_PROVIDER = resolve("core/test/fixtures/providers/codex/production-runner-fixture.mjs");
const SYSTEM_PROMPT_SENTINEL = "SYSTEM_PROMPT_CONTENT_MUST_NOT_RIDE_ARGV";

function configTextWithCommand(exitCode = 0): string {
  // Scripted adapters exercise ephemeral routes unless a test explicitly opts in.
  return readFileSync(resolve("awsf.config.yaml"), "utf8").replaceAll("interrupted_turn: true", "interrupted_turn: false").replace(
    "  seed_paths: [node_modules]",
    "  seed_paths: []",
  ).replace(
    "test: { argv: [npm, run, test:unit], timeout_seconds: 600 }",
    `test: { argv: [node, -e, process.exit(${exitCode})], timeout_seconds: 10 }`,
  ).replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
}

async function fixture(
  workflow: "scout" | "plan" | "build" | "plan-build-test" | "build-review" | "simple-sdlc" | "intake",
  commandExit = 0,
  configure: (config: AwsfConfig) => AwsfConfig = (config) => config,
  tier: 0 | 1 | 2 = 1,
  request = "write one bounded source",
  seed: (canonical: string) => void = () => {},
  routeOverrides: PhaseRouteOverrides = {},
) {
  const root = mkdtempSync(join(tmpdir(), "awsf-production-runner-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed production runner");
  seed(canonical);
  const configText = configTextWithCommand(commandExit);
  const config = configure(loadConfig(configText));
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText);
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      const destination = join(root, promptPath);
      mkdirSync(resolve(destination, ".."), { recursive: true });
      const marker = promptPath === "prompts/builder/system.md" ? `\n${SYSTEM_PROMPT_SENTINEL}\n` : "";
      writeFileSync(destination, `${readFileSync(resolve(promptPath), "utf8")}${marker}`);
    }
  }
  const sharedPrompt = join(root, "prompts/shared/headless-role.md");
  mkdirSync(resolve(sharedPrompt, ".."), { recursive: true });
  writeFileSync(sharedPrompt, readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: `fixture-${workflow}`, repository: canonical, request, workflow, tier, routeOverrides, configSnapshotJson: JSON.stringify(config), projectRecord: projection.project });
  // scout, plan and design-to-plan need every call their ceiling allows, so
  // `awsf start` refuses their unfundable correction round. Take the owner's
  // own remedy — which is also what proves the remedy works.
  const headroom = correctionHeadroom(config, workflowRecipe(workflow)!);
  if (headroom.unfundable) {
    await raiseCommand({
      attemptDir: created.attemptDir, calls: headroom.callsNeeded,
      reason: `fixture funds ${String(headroom.callsNeeded)} cold correction on ${workflow}`,
      terminal: { interactive: true, write: () => {}, confirm: async () => true },
      projectRecord: projection.project,
    });
  }
  await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath, preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project });
  return { root, canonical, stateRoot, config, configPath, projection, created };
}

for (const workflow of ["build", "plan-build-test", "simple-sdlc"] as const) {
  test(`A2 exact protected grant completes ${workflow} with one consumption, verified candidate and separate final approval`, async () => {
    const world = await fixture(workflow, 0, config => ({ ...config, policy: { ...config.policy, protected_paths: [...config.policy.protected_paths, "core/src/generated.ts"] } }), workflow === "simple-sdlc" ? 2 : 1);
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const granted = await grantCommand({ attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath, stateRoot: world.stateRoot,
        phase: "builder", files: ["core/src/generated.ts"], reason: "Create exactly the generated source.", sandboxProbe: () => true,
        terminal: { interactive: true, write: () => {}, confirm: async () => true }, projectRecord: world.projection.project });
      assert.equal(granted.confirmed, true); assert.equal(granted.status.candidateSha, null);
      let calls = 0;
      const status = await runProductionCommand({ attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
        projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement, assertLaunchProjection: world.projection.assertLaunchPermitted,
        infrastructure: { adapterFor: (_entry, id) => new ScriptedAdapter(id, prepared.worktree!, request => {
          calls++; if (!request.model.startsWith("claude:")) assert.match(request.prompt, /Host-verified one-use protected content grant/);
        }), createBroker: fakeBroker, sandboxProbe: () => true } });
      assert.equal(status.lifecycleState, "AWAITING_OWNER", JSON.stringify(status.blocker));
      const facts = readProtectedState(world.created.attemptDir);
      assert.equal(facts.consumptions.length, 1); assert.equal(facts.intents.length, 1); assert.equal(facts.bindings.length, 1);
      assert.equal(facts.bindings[0]!.parentSha, prepared.baseSha);
      assert.equal(inspectProtectedCandidate(world.created.attemptDir, status.candidateSha!).deltas.length, 1);
      assert.equal(status.budget.callsSpent, calls); assert.equal(status.budget.callsReserved, 0);
      if (workflow === "simple-sdlc") await journeyCommand({ attemptDir: world.created.attemptDir, journeyId: "protected-content-fixture", observedSha: status.candidateSha!,
        terminal: { interactive: true, write: () => {}, confirm: async () => true }, projectRecord: world.projection.project });
      const journal = readFileSync(join(world.created.attemptDir, "journal.jsonl"));
      const declined = await landCommand({ attemptDir: world.created.attemptDir, terminal: { interactive: true, write: () => {}, confirm: async () => false } });
      assert.equal(declined.confirmed, false); assert.deepEqual(readFileSync(join(world.created.attemptDir, "journal.jsonl")), journal);
      let confirmations = 0;
      const landed = await landCommand({ attemptDir: world.created.attemptDir, terminal: { interactive: true, write: () => {}, confirm: async () => { confirmations++; await assert.rejects(() => assertNoExecutionController(world.created.attemptDir), /controller/); return true; } }, projectRecord: world.projection.project });
      assert.equal(landed.status.lifecycleState, "LANDED", JSON.stringify(landed.status.blocker));
      assert.equal(confirmations, 2); assert.equal(git(world.canonical, "rev-parse", "HEAD"), status.candidateSha);
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });
}

for (const failure of ["decline", "noninteractive", "host", "outside-writes", "no-sandbox", "alias", "drift"] as const) {
  test(`A2 protected issuance ${failure} is inert`, async () => {
    const world = await fixture("build", 0, config => ({ ...config, policy: { ...config.policy, protected_paths: [...config.policy.protected_paths, "core/src/generated.ts"] } }));
    try {
      const before = readFileSync(join(world.created.attemptDir, "journal.jsonl"));
      const action = () => grantCommand({ attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath, stateRoot: world.stateRoot,
        phase: "builder", files: failure === "outside-writes" ? ["AGENTS.md"] : failure === "alias" ? ["core/src/generated.ts", "core/src/GENERATED.ts"] : ["core/src/generated.ts"],
        reason: "Bounded fixture grant.", actor: failure === "host" ? "host" : "human", sandboxProbe: () => failure !== "no-sandbox",
        terminal: { interactive: failure !== "noninteractive", write: () => {}, confirm: async () => {
          if (failure === "drift") { const status = await readAttempt(world.created.attemptDir); writeFileSync(join(status.worktree!, "changed.txt"), "external drift\n"); }
          return failure !== "decline";
        } } });
      if (failure === "decline") assert.equal((await action()).confirmed, false); else await assert.rejects(action);
      assert.deepEqual(readFileSync(join(world.created.attemptDir, "journal.jsonl")), before);
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });
}

for (const cut of ["ungranted", "bad-envelope", "binding-drift", "intent-crash", "head-crash", "publication-crash", "landing-drift"] as const) {
  test(`A2 ${cut} preserves evidence and never retries the protected generation`, async () => {
    const world = await fixture("build", 0, config => ({ ...config, policy: { ...config.policy, protected_paths: [...config.policy.protected_paths, "core/src/generated.ts"] } }));
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      await grantCommand({ attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath, stateRoot: world.stateRoot,
        phase: "builder", files: ["core/src/generated.ts"], reason: "One bounded generation.", sandboxProbe: () => true,
        terminal: { interactive: true, write: () => {}, confirm: async () => true } });
      let calls = 0; let injected = false;
      const before = readFileSync(join(world.created.attemptDir, "journal.jsonl"));
      if (cut === "binding-drift") writeFileSync(join(world.root, "prompts/builder/system.md"), "changed runtime prompt\n");
      const options = { attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
        projectRecord: async (record: Parameters<AttemptProjector>[0], status: Parameters<AttemptProjector>[1]) => {
          await world.projection.project(record, status);
          if (!injected && ((cut === "intent-crash" && record.event.evidence?.type === "protected-commit-intent") ||
              (cut === "publication-crash" && record.event.evidence?.type === "protected-candidate"))) { injected = true; throw new Error("fixture host observer crash"); }
        },
        infrastructure: { afterProtectedHeadPublished: () => { if (cut === "head-crash") throw new Error("fixture crash after HEAD CAS"); },
          adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {
          calls++;
          if (cut === "ungranted") { mkdirSync(join(prepared.worktree!, "core/src/state"), { recursive: true }); writeFileSync(join(prepared.worktree!, "core/src/state/ungranted.ts"), "ungranted\n"); }
        }, cut === "bad-envelope" ? "malformed" : "success"), createBroker: fakeBroker, sandboxProbe: () => true } };
      let result: Awaited<ReturnType<typeof runProductionCommand>> | null = null;
      try { result = await runProductionCommand(options); } catch (error) {
        assert.ok(cut === "binding-drift" || cut === "intent-crash" || cut === "head-crash" || cut === "publication-crash", String(error));
      }
      assert.equal(calls, cut === "binding-drift" ? 0 : 1);
      if (cut === "binding-drift") assert.deepEqual(readFileSync(join(world.created.attemptDir, "journal.jsonl")), before);
      if (cut === "landing-drift") {
        assert.equal(result?.lifecycleState, "AWAITING_OWNER");
        writeFileSync(join(prepared.worktree!, "core/src/generated.ts"), "changed after candidate binding\n");
        const journal = readFileSync(join(world.created.attemptDir, "journal.jsonl"));
        await assert.rejects(() => landCommand({ attemptDir: world.created.attemptDir, terminal: { interactive: true, write: () => {}, confirm: async () => assert.fail("drift must refuse before confirmation") } }), /protected/);
        assert.deepEqual(readFileSync(join(world.created.attemptDir, "journal.jsonl")), journal);
      } else if (cut !== "binding-drift") {
        const facts = readProtectedState(world.created.attemptDir);
        assert.equal(facts.consumptions.length, 1);
        assert.equal(facts.bindings.length, cut === "publication-crash" || cut === "head-crash" ? 1 : 0);
        if (cut.endsWith("crash")) assert.equal(facts.intents.length, 1);
        const head = git(prepared.worktree!, "rev-parse", "HEAD");
        const indexPath = git(prepared.worktree!, "rev-parse", "--path-format=absolute", "--git-path", "index");
        const sealed = ["BLOCKED", "CANCELLED", "PUBLISHED"].includes((await readAttempt(world.created.attemptDir)).lifecycleState);
        if (cut === "head-crash") {
          // BUG-1. The interruption is thrown, not fatal, and it lands after the
          // HEAD compare-and-swap: the same process, still holding the same
          // lease and the same one-use authority, and this attempt has not
          // sealed yet. So the remainder of that one authorized act — install
          // the pinned index, append the binding it had already computed — is
          // completed here rather than orphaned behind the sealed state that
          // correctly refuses to bind it. Nothing is created or replayed.
          assert.equal(head, facts.intents[0]!.binding.candidateSha);
          assert.equal(facts.bindings[0]!.candidateSha, facts.intents[0]!.binding.candidateSha);
          assert.equal(existsSync(`${indexPath}.lock`), false, "the interrupted run's own index lock must not outlive it");
          assert.equal(git(prepared.worktree!, "status", "--porcelain"), "", "the installed index must match the published candidate");
          assert.equal(sealed, true, "the interruption still fails the phase and seals the attempt");
        }
        // Captured after the head-crash checks above, because `git status`
        // refreshes the index's stat cache and would otherwise make the
        // preservation comparison below fail against a byte-identical tree.
        const index = readFileSync(indexPath); const contents = readFileSync(join(prepared.worktree!, "core/src/generated.ts"));
        const retained = facts.intents.length === 1 && facts.bindings.length === 0 && !sealed ? facts.intents[0]! : null;
        const resume = { ...options, reason: "observe without replay", terminal: { interactive: true, write: () => {}, confirm: async () => true } };
        if (retained === null) {
          // Nothing is outstanding: the binding is durable or no host effect
          // ever started. Resume may refuse or block, but it never replays the
          // one-use generation and never touches the retained bytes.
          const outcome = await resumeProductionCommand(resume).then(value => value.status.lifecycleState, error => String(error));
          assert.match(outcome, /BLOCKED|protected|recovery refused/);
          // head-crash no longer reaches the sealed-binding refusal: the
          // interruption was handled, so its publication was completed before
          // the attempt sealed and no effect is left outstanding to refuse.
          if (sealed && cut !== "head-crash") assert.match(outcome, /sealed in BLOCKED|recovery refused/);
          assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), head);
          assert.deepEqual(readFileSync(indexPath), index);
        } else {
          // A3: the interrupted publication is completed from durable evidence.
          // A declined confirmation is inert.
          const declined = await resumeProductionCommand({ ...resume, terminal: { ...resume.terminal, confirm: async () => false } });
          assert.equal(declined.confirmed, false);
          assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), head);
          assert.deepEqual(readFileSync(indexPath), index);

          const done = await resumeProductionCommand(resume);
          assert.equal(done.confirmed, true);
          assert.equal(done.status.candidateSha, retained.binding.candidateSha);
          assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), retained.binding.candidateSha);
          assert.equal(git(prepared.worktree!, "rev-parse", `${retained.binding.candidateSha}^{tree}`), retained.binding.treeSha);
          assert.equal(git(prepared.worktree!, "status", "--porcelain"), "", "the reconciled index must match the published candidate");
          assert.equal(existsSync(`${indexPath}.lock`), false);
          const after = readProtectedState(world.created.attemptDir);
          assert.equal(after.bindings.length, 1);
          assert.equal(after.bindings[0]!.candidateSha, retained.binding.candidateSha);
          // Replaying the same act is a no-op: there is nothing left unfinished.
          const stable = readFileSync(join(world.created.attemptDir, "journal.jsonl"));
          const again = await resumeProductionCommand(resume).then(() => "resolved", error => String(error));
          assert.match(again, /resolved|BLOCKED|protected|recovery refused/);
          assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), retained.binding.candidateSha);
          if (again !== "resolved") assert.deepEqual(readFileSync(join(world.created.attemptDir, "journal.jsonl")), stable);
        }
        assert.deepEqual(readFileSync(join(prepared.worktree!, "core/src/generated.ts")), contents); assert.equal(calls, 1);
      }
      assert.equal(git(world.canonical, "rev-parse", "HEAD"), prepared.baseSha);
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });
}

const PROTECTED_KILL_HOST = join(import.meta.dirname, "_protected-kill-host.ts");

/**
 * A world stopped exactly inside the protected publication window.
 *
 * The injection throws while the durable `protected-commit-intent` is being
 * projected, so the transport never opened its index lock: the candidate object
 * already exists, HEAD is still the granted pre-write revision, and the index is
 * the pre-publication one. That is the `unpublished` cut, reached by running the
 * real commands rather than by hand-writing a journal, and it is the state every
 * test below starts from.
 */
async function retainedProtectedEffect() {
  const world = await fixture("build", 0, config => ({ ...config, policy: { ...config.policy, protected_paths: [...config.policy.protected_paths, "core/src/generated.ts"] } }));
  const prepared = await readAttempt(world.created.attemptDir);
  await grantCommand({ attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath, stateRoot: world.stateRoot,
    phase: "builder", files: ["core/src/generated.ts"], reason: "One bounded generation.", sandboxProbe: () => true,
    terminal: { interactive: true, write: () => {}, confirm: async () => true }, projectRecord: world.projection.project });
  let calls = 0; let injected = false;
  const options = { attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
    projectRecord: async (record: Parameters<AttemptProjector>[0], status: Parameters<AttemptProjector>[1]) => {
      await world.projection.project(record, status);
      if (!injected && record.event.evidence?.type === "protected-commit-intent") { injected = true; throw new Error("fixture host observer crash"); }
    },
    infrastructure: { adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => { calls++; }),
      createBroker: fakeBroker, sandboxProbe: () => true } };
  await assert.rejects(() => runProductionCommand(options));
  const worktree = prepared.worktree!;
  const indexPath = git(worktree, "rev-parse", "--path-format=absolute", "--git-path", "index");
  const facts = readProtectedState(world.created.attemptDir);
  assert.equal(facts.intents.length, 1);
  assert.equal(facts.bindings.length, 0);
  assert.equal(git(worktree, "rev-parse", "HEAD"), facts.intents[0]!.binding.parentSha);
  assert.equal(existsSync(`${indexPath}.lock`), false);
  const status = await readAttempt(world.created.attemptDir);
  assert.equal(["BLOCKED", "CANCELLED", "PUBLISHED"].includes(status.lifecycleState), false,
    `an intent cut must leave a reconcilable attempt, not one sealed in ${status.lifecycleState}`);
  const generated = join(worktree, "core/src/generated.ts");
  const journalPath = join(world.created.attemptDir, "journal.jsonl");
  return { world, worktree, indexPath, options, intent: facts.intents[0]!,
    resume: (terminal: { interactive: boolean; write: () => void; confirm: () => Promise<boolean> }) =>
      resumeProductionCommand({ ...options, reason: "reconcile the retained protected host effect", terminal }),
    modelCalls: () => calls,
    snapshot: () => ({ head: git(worktree, "rev-parse", "HEAD"), index: readFileSync(indexPath),
      journal: readFileSync(journalPath), generated: readFileSync(generated),
      lock: existsSync(`${indexPath}.lock`) ? readFileSync(`${indexPath}.lock`) : null }) };
}

const confirming = { interactive: true, write: () => {}, confirm: async () => true };
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Kill a real host inside the real publication protocol, and prove it died there. */
function killProtectedHost(attemptDir: string, stage: "head" | "binding"): void {
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", PROTECTED_KILL_HOST, attemptDir, stage], { encoding: "utf8" });
  assert.equal(child.signal, "SIGKILL", `the injection must land: ${String(child.status)} ${child.stdout}${child.stderr}`);
}

for (const stage of ["head", "binding"] as const) {
  test(`A3 reconciles a protected publication after genuine process death at the ${stage} boundary`, async () => {
    const retained = await retainedProtectedEffect();
    const { world, worktree, indexPath, intent } = retained;
    try {
      const before = await readAttempt(world.created.attemptDir);
      killProtectedHost(world.created.attemptDir, stage);

      // What a power cut at that boundary leaves. No `finally` ran, so for the
      // HEAD cut the lock is still present and the index is still the
      // pre-publication one; for the binding cut both are finished and only the
      // journal is behind. Neither death wrote a lifecycle transition, which is
      // exactly why a hard death is not the same event as a caught exception.
      assert.equal(git(worktree, "rev-parse", "HEAD"), intent.binding.candidateSha);
      assert.equal(existsSync(`${indexPath}.lock`), stage === "head");
      assert.equal(existsSync(join(world.created.attemptDir, "execution-lease.json")), true, "a killed host never releases its lease");
      const dead = readProtectedState(world.created.attemptDir);
      assert.equal(dead.intents.length, 1);
      assert.equal(dead.bindings.length, 0);
      assert.equal((await readAttempt(world.created.attemptDir)).revision, before.revision);

      // Declining is inert even here.
      const inert = retained.snapshot();
      const declined = await retained.resume({ ...confirming, confirm: async () => false });
      assert.equal(declined.confirmed, false);
      assert.deepEqual(retained.snapshot(), inert);

      const done = await retained.resume(confirming);
      assert.equal(done.confirmed, true);
      assert.equal(done.status.candidateSha, intent.binding.candidateSha);
      assert.equal(git(worktree, "rev-parse", "HEAD"), intent.binding.candidateSha);
      assert.equal(git(worktree, "status", "--porcelain"), "", "the installed index must match the published candidate");
      assert.equal(existsSync(`${indexPath}.lock`), false, "adopting the dead host's own lock completes the rename it never reached");
      const after = readProtectedState(world.created.attemptDir);
      assert.equal(after.bindings.length, 1);
      assert.equal(after.bindings[0]!.candidateSha, intent.binding.candidateSha);
      assert.deepEqual(readFileSync(join(worktree, "core/src/generated.ts")), inert.generated);
      assert.equal(retained.modelCalls(), 1, "reconciliation repeats no model call");
      assert.equal(done.status.budget.callsSpent, before.budget.callsSpent, "reconciliation spends nothing");
      assert.equal(done.status.budget.callsReserved, before.budget.callsReserved);
      assert.equal(git(world.canonical, "rev-parse", "HEAD"), before.baseSha, "nothing is pushed or landed by reconciling");
    } finally { rmSync(world.root, { recursive: true, force: true }); }
  });
}

test("A3 refuses a publication whose attempt is sealed while the owner is deciding, and touches nothing", async () => {
  const retained = await retainedProtectedEffect();
  const { world } = retained;
  try {
    killProtectedHost(world.created.attemptDir, "head");
    const inert = retained.snapshot();
    // The seal lands inside the confirmation, which is precisely the window the
    // pre-confirmation check cannot see. Completing the publication afterwards
    // would leave the repository holding a candidate the journal can never
    // record, so the whole act must become a refusal that writes nothing.
    await assert.rejects(() => retained.resume({ ...confirming, confirm: async () => {
      const current = await readAttempt(world.created.attemptDir);
      await persistAttempt(world.created.attemptDir, current.revision, { kind: "attempt.updated",
        next: nextRevision(current, { lifecycleState: "CANCELLED" }) }, world.projection.project);
      return true;
    } }), /sealed in CANCELLED/);
    const after = retained.snapshot();
    assert.equal(after.head, inert.head);
    assert.deepEqual(after.index, inert.index);
    assert.deepEqual(after.lock, inert.lock);
    assert.deepEqual(after.generated, inert.generated);
    assert.equal(readProtectedState(world.created.attemptDir).bindings.length, 0, "a sealed attempt takes no binding");
    // Still exactly the half-published state the kill left: HEAD at the
    // candidate, the index still the pre-publication one. A working tree that
    // reads as dirty here is correct — that disagreement IS the unfinished
    // publication, and refusing means leaving it alone rather than tidying it.
    assert.equal(after.head, retained.intent.binding.candidateSha);
    assert.equal(sha256Hex(after.index), retained.intent.beforeIndexDigest);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

for (const tamper of ["foreign-bytes", "symlink", "hardlink", "other-readable", "live-holder"] as const) {
  test(`A3 never breaks a ${tamper} Git index lock`, async () => {
    const retained = await retainedProtectedEffect();
    const { world, indexPath, intent } = retained;
    const lockPath = `${indexPath}.lock`;
    const staged = stagedIndexBytes(world.created.attemptDir, intent);
    const decoy = join(world.root, "decoy-index");
    let holder: ReturnType<typeof spawn> | null = null;
    try {
      // Every variant but the first plants the EXACT staged bytes at mode 0600
      // — which is precisely what the digest-equals-ownership rule accepted as
      // proof. Each must still refuse, and for its own reason: a symlink points
      // elsewhere, a hardlink is an alias into another file, a mode this code
      // never writes is not this code's lock, and a visible holder is a lock in
      // use.
      if (tamper === "foreign-bytes") writeFileSync(lockPath, "another holder is mid-write\n", { mode: 0o600 });
      if (tamper === "symlink") { writeFileSync(decoy, staged, { mode: 0o600 }); symlinkSync(decoy, lockPath); }
      if (tamper === "hardlink") { writeFileSync(decoy, staged, { mode: 0o600 }); linkSync(decoy, lockPath); }
      if (tamper === "other-readable") writeFileSync(lockPath, staged, { mode: 0o644 });
      if (tamper === "live-holder") {
        writeFileSync(lockPath, staged, { mode: 0o600 });
        holder = spawn(process.execPath, ["-e", "const fs=require('node:fs');fs.openSync(process.argv[1],'r');process.stdout.write('held\\n');setInterval(()=>{},1000);", lockPath]);
        await new Promise<void>((resolve, reject) => {
          holder!.stdout!.once("data", () => { resolve(); });
          holder!.once("exit", () => { reject(new Error("the lock holder exited before it held anything")); });
        });
      }
      const inert = retained.snapshot();
      await assert.rejects(() => retained.resume(confirming),
        tamper === "symlink" ? /symbolic link/
          : tamper === "hardlink" ? /regular, single-link file owned by this user/
          : tamper === "other-readable" ? /reachable by other accounts/
          : tamper === "live-holder" ? /still open in live process/
          : /does not break another holder's lock/);
      const after = retained.snapshot();
      assert.equal(after.head, inert.head, "a refused adoption moves no reference");
      assert.deepEqual(after.index, inert.index);
      assert.deepEqual(after.lock, inert.lock, "the lock this recovery does not own is left exactly as it was");
      assert.deepEqual(after.journal, inert.journal);
      assert.equal(readProtectedState(world.created.attemptDir).bindings.length, 0);
      if (tamper === "symlink" || tamper === "hardlink") assert.deepEqual(readFileSync(decoy), staged, "the lock's target is never written through");
    } finally {
      holder?.kill("SIGKILL");
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

for (const tamper of ["index-drift", "granted-bytes", "root-identity", "redirected-index"] as const) {
  test(`A3 refuses a retained publication when ${tamper} moved, and completes nothing`, async () => {
    const retained = await retainedProtectedEffect();
    const { world, worktree, indexPath } = retained;
    const generated = join(worktree, "core/src/generated.ts");
    const previousIndexFile = process.env["GIT_INDEX_FILE"];
    try {
      if (tamper === "index-drift") writeFileSync(indexPath, "not a Git index\n");
      if (tamper === "granted-bytes") writeFileSync(generated, "export const generated = false;\n");
      // One of the four physical roots the grant pinned by device, inode, uid,
      // gid and mode. Changing only the mode leaves every byte of the tree
      // alone and still means this is not the machine state the grant recorded.
      if (tamper === "root-identity") chmodSync(worktree, 0o700);
      if (tamper === "redirected-index") process.env["GIT_INDEX_FILE"] = join(world.root, "hijacked-index");
      const inert = retained.snapshot();
      await assert.rejects(() => retained.resume(confirming),
        tamper === "index-drift" ? /neither the exact pre-publication nor the exact staged bytes/
          : tamper === "granted-bytes" ? /granted worktree bytes no longer match|protected content/
          : tamper === "root-identity" ? /protected repository root identity changed/
          : /redirected away from the granted worktree Git directory/);
      const after = retained.snapshot();
      assert.equal(after.head, inert.head);
      assert.deepEqual(after.index, inert.index);
      assert.equal(after.lock, null, "a refusal opens no lock");
      assert.deepEqual(after.journal, inert.journal);
      assert.equal(readProtectedState(world.created.attemptDir).bindings.length, 0);
      assert.equal(retained.modelCalls(), 1, "a refusal repeats no model call");
    } finally {
      if (previousIndexFile === undefined) delete process.env["GIT_INDEX_FILE"]; else process.env["GIT_INDEX_FILE"] = previousIndexFile;
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

test("A2 racing owner confirmations issue exactly one protected generation", async () => {
  const world = await fixture("build", 0, config => ({ ...config, policy: { ...config.policy, protected_paths: [...config.policy.protected_paths, "core/src/generated.ts"] } }));
  try {
    let count = 0; let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const options = { attemptDir: world.created.attemptDir, config: world.config, configPath: world.configPath, stateRoot: world.stateRoot,
      phase: "builder", files: ["core/src/generated.ts"], reason: "Exact racing confirmation.", sandboxProbe: () => true,
      terminal: { interactive: true, write: () => {}, confirm: async () => { count++; if (count === 2) release(); await barrier; return true; } } };
    const results = await Promise.allSettled([grantCommand(options), grantCommand(options)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(readProtectedState(world.created.attemptDir).grants.length, 1);
  } finally { rmSync(world.root, { recursive: true, force: true }); }
});

test("requested retention on an incomplete adapter blocks before any reservation or provider launch", async () => {
  const world = await fixture("build", 0, config => ({ ...config, agents: config.agents.map(agent => agent.name === "builder"
    ? { ...agent, harness: { ...agent.harness, interrupted_turn: true } } : agent) }));
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({ attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config, configPath: world.configPath, projectRecord: world.projection.project,
      assertAdvancement: world.projection.assertAdvancement, assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry, id) => new ScriptedAdapter(id, prepared.worktree!, () => assert.fail("provider must not launch")),
        createBroker: () => assert.fail("unsupported retention must refuse before broker construction"),
        sandboxProbe: () => false,
      } });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.match(status.blocker?.detail ?? "", /original-turn persistence.*no complete continuity transport/);
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(status.candidateSha, null);
    assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
  } finally { world.projection.close(); rmSync(world.root, { recursive: true, force: true }); }
});

for (const workflow of ["scout", "plan"] as const) {
  test(`production ${workflow} retains a read-only result and reaches the owner without a candidate commit`, async () => {
    const world = await fixture(workflow, 0, (config) => config, 0);
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const status = await runProductionCommand({
        attemptDir: world.created.attemptDir,
        stateRoot: world.stateRoot,
        config: world.config,
        configPath: world.configPath,
        projectRecord: world.projection.project,
        assertAdvancement: world.projection.assertAdvancement,
        assertLaunchProjection: world.projection.assertLaunchPermitted,
        infrastructure: {
          adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}),
          createBroker: fakeBroker,
          sandboxProbe: () => false,
        },
      });

      assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
      assert.equal(status.candidateSha, null);
      assert.equal(status.budget.callsSpent, 1);
      assert.equal(status.gatesPass, true);
      assert.match(status.nextAction, /inspect the retained awsf\.(?:scout|plan)-output\/v1 envelope/);
      assert.doesNotMatch(status.nextAction, /awsf land/);
      assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), status.baseSha);
      assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
    } finally {
      world.projection.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

test("production intake writes one validated ticket candidate and reaches the owner", async () => {
  const world = await fixture("intake", 0, (config) => ({
    ...config,
    agents: config.agents.map((agent) => agent.name === "intake"
      ? { ...agent, harness: { ...agent.harness, continuity: "none" as const } }
      : agent),
  }), 0);
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      assertAdvancement: world.projection.assertAdvancement,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}),
        createBroker: fakeBroker,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 1);
    assert.ok(status.candidateSha);
    assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), status.candidateSha);
    const [ticket] = await new TicketStore(join(prepared.worktree!, "specs", "tickets")).load();
    assert.equal(ticket?.ticket?.id, "T99");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("production simple-sdlc completes planner, builder, tests, and inverse review", async () => {
  const world = await fixture("simple-sdlc", 0, (config) => config, 2);
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const prompts: string[] = [];
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      assertAdvancement: world.projection.assertAdvancement,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, (request) => prompts.push(request.prompt)),
        createBroker: fakeBroker,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 4, "planner, builder, documenter, and mandatory reviewer");
    assert.equal(status.requiredReviewPresent, true);
    assert.ok(status.candidateSha);
    assert.equal(prompts.length, 4);
    assert.ok(prompts.every((prompt) => prompt.includes(`Owner-recorded request (verbatim):\n${prepared.request}\n`)));
    const reportPath = join(dirname(world.created.attemptDir), "run-reports", "attempt-1-bounded-source.md");
    assert.equal(reportPath.startsWith(`${world.created.attemptDir}/`), false, "the report projection never writes into a sealed attempt");
    assert.equal(existsSync(reportPath), true);
    assert.ok((await statusCommand(world.created.attemptDir)).includes(`Run report: ${reportPath} — human-readable projection of the retained attempt evidence`));
    const report = readFileSync(reportPath, "utf8");
    assert.match(report, /## Request/);
    assert.match(report, /## Host gates/);
    assert.match(report, /Verdict: accept/);
    assert.match(report, /State: AWAITING_OWNER/);
    assert.match(report, /Calls: 4 spent/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("simple-sdlc documenter with no project-doc change succeeds and still authors the run report", async () => {
  const world = await fixture("simple-sdlc", 0, (config) => config, 2);
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      assertAdvancement: world.projection.assertAdvancement,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}, "documenter-noop"),
        createBroker: fakeBroker,
        sandboxProbe: () => false,
      },
    });

    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.notEqual(status.blocker?.code, "permission-breach");
    assert.equal(git(prepared.worktree!, "show", `${status.candidateSha}:README.md`), "base");
    const report = readFileSync(join(dirname(world.created.attemptDir), "run-reports", "attempt-1-bounded-source.md"), "utf8");
    assert.match(report, /The bounded source was planned, built/);
    assert.match(report, /State: AWAITING_OWNER/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

for (const [workflow, expectedCalls] of [["build", 1], ["plan-build-test", 2]] as const) {
  test(`production ${workflow} uses ${expectedCalls} configured call(s), exact host gates, and no fallback`, async () => {
    const world = await fixture(workflow);
    let launches = 0;
    let sawRunning = false;
    let sawLiveAgent = false;
    let sawLiveSandbox = false;
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const status = await runProductionCommand({
        attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
        projectRecord: world.projection.project, assertAdvancement: world.projection.assertAdvancement,
        assertLaunchProjection: world.projection.assertLaunchPermitted,
        infrastructure: {
          adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {
            launches += 1;
            const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
            try {
              sawRunning ||= getSession(db, world.created.status.sessionId)?.lifecycle_state === "RUNNING";
              const live = agentsForSession(db, world.created.status.sessionId).find((agent) => agent.resolved_model === null);
              sawLiveAgent ||= live?.requested_model !== null && live?.resolved_model === null && live?.input_tokens === null;
              sawLiveSandbox ||= live?.sandbox_badge === "tool-policy" && live?.sandbox_mechanism === "adapter-tool-policy";
            } finally { db.close(); }
          }),
          createBroker: fakeBroker,
          sandboxProbe: () => false,
        },
      });
      assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
      assert.equal(status.budget.callsSpent, expectedCalls);
      assert.equal(status.budget.callsReserved, 0);
      assert.equal(launches, expectedCalls);
      assert.equal(sawRunning, true, "dashboard projection must see RUNNING before provider completion");
      assert.equal(sawLiveAgent, true, "route-attributed agent evidence must be visible before provider completion");
      assert.equal(sawLiveSandbox, true, "the broker grant must be visible before provider completion");
      assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
      assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), status.candidateSha);
      assert.match(git(prepared.worktree!, "show", "-s", "--format=%an <%ae>", "HEAD"), /Santiago Marin <santiagomarinsuarez@me.com>/);
      const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
      try {
        assert.equal(phasesForSession(db, status.sessionId).at(-1)?.status, "SUCCEEDED");
        const gates = gatesForSession(db, status.sessionId);
        assert.ok(gates.every((gate) => gate.passed === 1));
        const hygiene = gates.find((gate) => gate.gate_id === "candidate_hygiene");
        assert.equal(hygiene?.candidate_sha, status.candidateSha);
        assert.equal(hygiene?.gate_kind, "git");
        const agents = agentsForSession(db, status.sessionId);
        assert.equal(agents.length, expectedCalls);
        assert.ok(agents.every((agent) => agent.input_tokens === 10 && agent.output_tokens === 20));
        assert.ok(agents.every((agent) => agent.model_provenance === "route-attributed"));
        assert.equal(getSession(db, status.sessionId)?.input_tokens, expectedCalls * 10);
        assert.equal(getSession(db, status.sessionId)?.output_tokens, expectedCalls * 20);
        assert.ok(pollEvents(db, status.sessionId, 0).some((event) => event.type === "usage"));
      } finally { db.close(); }
      assert.doesNotMatch(readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8"), /substituteAttempted/);
    } finally {
      world.projection.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

test("process-backed production build crosses the real barrier, parser, audit, and API privacy boundaries", async () => {
  const world = await fixture("build");
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const running = runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      assertAdvancement: world.projection.assertAdvancement,
      infrastructure: {
        adapterFor: () => new CapturedPiAdapter("success", 1_200),
        createBroker: (options) => new ProcessTransportBroker(options),
        sandboxProbe: () => false,
      },
    });

    // The run above is deliberately NOT awaited: this test has to reach the API
    // while a real process is still live, so it races a genuine subprocess.
    // The deadline therefore bounds STARTUP — worktree, spawn, first write — and
    // not the live window itself, and the loop exits the moment the probe lands,
    // so a generous bound costs a healthy run nothing. Five seconds was tight
    // enough that a full-suite run on a network-backed filesystem missed it and
    // reported a passing factory as a broken one.
    const probePath = join(world.created.attemptDir, "private", "builder", "provider-probe.json");
    const deadline = Date.now() + 30_000;
    while (!existsSync(probePath) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    assert.equal(
      existsSync(probePath), true,
      "process-backed fixture never entered its live window within 30s of launch",
    );
    const liveRouter = createApiRouter({ dbPath: join(world.stateRoot, "awsf.db"), config: world.config });
    try {
      const response = await liveRouter.dispatch({ method: "GET", url: `/api/v1/sessions/${world.created.status.sessionId}`, headers: { host: "127.0.0.1:4600" } });
      assert.equal(response.status, 200);
      const candidate = response.body as import("../../../dashboard/shared/types.ts").SessionDetailResponse;
      assert.equal(candidate.state, "RUNNING");
      const builder = candidate.agents.find((agent) => agent.agent === "builder");
      assert.equal(builder?.provider, "openai-codex");
      assert.equal(builder?.requestedModel, "codex:gpt-5.6-sol");
      assert.equal(builder?.resolvedModel, null);
      assert.equal(builder?.inputTokens, null);
      assert.equal(builder?.sandboxBadge, "tool-policy");
      assert.equal(builder?.sandboxMechanism, "adapter-tool-policy");
      assert.ok(candidate.activity.length > 0, "real phase/event timestamps advance during RUNNING");
      assert.ok(candidate.processes.some((process) => process.status === "RUNNING"));
    } finally { liveRouter.close(); }

    const status = await running;
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 1);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
    assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), status.candidateSha);

    const systemPromptPath = join(world.created.attemptDir, "private", "builder", "system-prompt.md");
    const probe = JSON.parse(readFileSync(join(world.created.attemptDir, "private", "builder", "provider-probe.json"), "utf8")) as {
      argv: string[];
      promptContentInArgv: boolean;
      systemPromptContentInArgv: boolean;
      registeredBeforeProviderStart: boolean;
      spentBeforeProviderStart: boolean;
      journalSourceSeqsAtProviderStart: number[];
    };
    assert.equal(probe.registeredBeforeProviderStart, true, "the provider observed durable registration before it began");
    assert.equal(probe.spentBeforeProviderStart, true, "the provider observed durable spend before GO");
    assert.equal(probe.promptContentInArgv, false);
    assert.equal(probe.systemPromptContentInArgv, false);
    assert.equal(probe.argv.includes(SYSTEM_PROMPT_SENTINEL), false);
    assert.deepEqual(probe.journalSourceSeqsAtProviderStart, probe.journalSourceSeqsAtProviderStart.map((_value, index) => index + 1));

    const journal: string = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    const records: { source_seq: number }[] = journal.split("\n").filter(Boolean).map((line: string) => JSON.parse(line) as { source_seq: number });
    assert.deepEqual(records.map((record: { source_seq: number }) => record.source_seq), records.map((_record: { source_seq: number }, index: number) => index + 1), "register, spend, and events must serialize without a status revision race");

    const dbPath = join(world.stateRoot, "awsf.db");
    const db = openDatabase(dbPath, { readonly: true });
    try {
      const audit = db.prepare("SELECT command_json, cwd_display FROM processes WHERE session_id = ?").get(status.sessionId) as { command_json: string; cwd_display: string };
      const exactCommand = JSON.parse(audit.command_json) as string[];
      assert.equal(exactCommand.includes(systemPromptPath), true, "machine-local audit retains exact system-prompt path evidence");
      assert.equal(exactCommand.includes(SYSTEM_PROMPT_SENTINEL), false, "system-prompt content never rides argv");
      assert.equal(audit.cwd_display, prepared.worktree);
      const publicProcesses = processesForSession(db, status.sessionId);
      assert.equal(JSON.stringify(publicProcesses).includes(systemPromptPath), false);
      assert.equal(JSON.stringify(publicProcesses).includes(prepared.worktree!), false);
      assert.equal(publicProcesses[0]?.status, "EXITED");
      const usageEvents = pollEvents(db, status.sessionId, 0).filter((event) => event.type === "usage");
      assert.equal(usageEvents.length, 1);
      assert.equal(agentsForSession(db, status.sessionId)[0]?.input_tokens, 7);
      assert.equal(agentsForSession(db, status.sessionId)[0]?.output_tokens, 11);
      assert.equal(getSession(db, status.sessionId)?.input_tokens, 7, "one provider usage report is counted once");
      assert.equal(getSession(db, status.sessionId)?.output_tokens, 11, "one provider usage report is counted once");
      assert.ok(gatesForSession(db, status.sessionId).every((gate) => gate.passed === 1));
      const envelopeRefs = db.prepare("SELECT file_path FROM envelopes WHERE session_id = ?").all(status.sessionId) as unknown as { file_path: string }[];
      assert.ok(envelopeRefs.every((row) => !isAbsolute(row.file_path) && !row.file_path.includes(world.created.attemptDir)));
      const outputRefs = db.prepare("SELECT output_path FROM gate_results WHERE session_id = ? AND output_path IS NOT NULL").all(status.sessionId) as unknown as { output_path: string }[];
      assert.ok(outputRefs.every((row) => !isAbsolute(row.output_path) && !row.output_path.includes(world.created.attemptDir)));
    } finally {
      db.close();
    }

    const router = createApiRouter({ dbPath, config: world.config });
    try {
      const response = await router.dispatch({ method: "GET", url: `/api/v1/sessions/${status.sessionId}`, headers: { host: "127.0.0.1:4600" } });
      assert.equal(response.status, 200);
      const publicJson = JSON.stringify(response.body);
      for (const privatePath of [world.root, world.created.attemptDir, prepared.worktree!, systemPromptPath, CAPTURED_PROVIDER]) {
        assert.equal(publicJson.includes(privatePath), false, `API leaked private path ${privatePath}`);
      }
      assert.equal(publicJson.includes("command_json"), false);
      assert.equal(publicJson.includes("cwd_display"), false);
    } finally {
      router.close();
    }

    const processList = execFileSync("ps", ["-eo", "args="], { encoding: "utf8" });
    assert.equal(processList.includes(systemPromptPath), false, "the provider process must leave no residue");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("process-backed parser failure bills the spent call but leaves no held reservation", async () => {
  const world = await fixture("build");
  try {
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: () => new CapturedPiAdapter("parser-failure"),
        createBroker: (options) => new ProcessTransportBroker(options),
        sandboxProbe: () => false,
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 1);
    assert.equal(status.budget.callsReserved, 0);
    const probe = JSON.parse(readFileSync(join(world.created.attemptDir, "private", "builder", "provider-probe.json"), "utf8")) as { registeredBeforeProviderStart: boolean; spentBeforeProviderStart: boolean };
    assert.equal(probe.registeredBeforeProviderStart, true);
    assert.equal(probe.spentBeforeProviderStart, true);
    const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
    try { assert.equal(processesForSession(db, status.sessionId)[0]?.status, "FAILED"); }
    finally { db.close(); }
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

class UnavailableAdapter extends ScriptedAdapter {
  override async isAvailable(): Promise<Availability> { return { status: "blocked", code: "E_INVALID_REQUEST", detail: "fixture unavailable" }; }
}

class SameSessionAdapter extends ScriptedAdapter {
  override async getModelInfo(model: string): Promise<ModelInfo> {
    return { ...(await super.getModelInfo(model)), continuity: "same-session-correction" };
  }
}

function withBuilderContinuity(config: AwsfConfig, continuity: "same-session" | "none"): AwsfConfig {
  return {
    ...config,
    agents: config.agents.map((agent) => agent.name === "builder"
      ? { ...agent, harness: { ...agent.harness, continuity } }
      : agent),
  };
}

function registrationFailingBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration) {
      options.ledger.releaseOnRegistrationFailure(reservationIdOf(registration));
      throw new Error("fixture registration failure before GO");
    },
  };
}

for (const scenario of ["malformed", "permission", "gate"] as const) {
  test(`${scenario} production evidence reaches a terminal blocker with no held reservation`, async () => {
    const world = await fixture("build");
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const status = await runProductionCommand({
        attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
        projectRecord: world.projection.project, assertLaunchProjection: world.projection.assertLaunchPermitted,
        infrastructure: {
          adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}, scenario),
          createBroker: fakeBroker, sandboxProbe: () => false,
        },
      });
      assert.equal(status.lifecycleState, "BLOCKED");
      assert.equal(status.budget.callsSpent, scenario === "malformed" ? 2 : 1);
      assert.equal(status.budget.callsReserved, 0);
      if (scenario === "malformed") {
        assert.match(status.blocker?.detail ?? "", /EnvelopeValidationFailure/);
        assert.equal(status.budget.correctionsAuto, 1, "the cold envelope correction was actually spent");
      }
      if (scenario === "permission") assert.equal(status.blocker?.code, "permission-breach");
      if (scenario === "gate") assert.match(status.blocker?.detail ?? "", /PhaseGateFailure/);
    } finally {
      world.projection.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

for (const [scenario, failedGate, failedCheck] of [
  ["planner-open-question-once", "envelope_valid", "no blocking open questions"],
  ["planner-planned-artifact-once", "artifacts_exist", "core/src/future-output.ts"],
] as const) {
  test(`${scenario} is induced, cold-corrected, and then reaches the owner`, async () => {
    const world = await fixture("plan-build-test");
    try {
      const prepared = await readAttempt(world.created.attemptDir);
      const status = await runProductionCommand({
        attemptDir: world.created.attemptDir,
        stateRoot: world.stateRoot,
        config: world.config,
        configPath: world.configPath,
        projectRecord: world.projection.project,
        assertAdvancement: world.projection.assertAdvancement,
        assertLaunchProjection: world.projection.assertLaunchPermitted,
        infrastructure: {
          adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}, scenario),
          createBroker: fakeBroker,
          sandboxProbe: () => false,
        },
      });

      assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
      assert.equal(status.budget.callsSpent, 3, "two ordinary phases plus one paid cold correction");
      assert.equal(status.budget.correctionsAuto, 0, "the next phase refreshes the per-phase meter");
      assert.equal(existsSync(join(world.created.attemptDir, "envelopes", "planner-0.json")), true);
      assert.equal(existsSync(join(world.created.attemptDir, "envelopes", "planner-1.json")), true);

      const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
      try {
        const plannerGates = gatesForSession(db, status.sessionId, `${status.sessionId}:planner`);
        const induced = plannerGates.find((gate) => gate.correction_round === 0 && gate.gate_id === failedGate);
        assert.equal(induced?.passed, 0);
        assert.match(induced?.violations_json ?? "", new RegExp(failedCheck.replaceAll(".", "\\.")));
        const removed = plannerGates.find((gate) => gate.correction_round === 1 && gate.gate_id === failedGate);
        assert.equal(removed?.passed, 1);
      } finally { db.close(); }
    } finally {
      world.projection.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

test("simple-sdlc accepts planner=A, builder=B, reviewer=A before launch", async () => {
  const world = await fixture("simple-sdlc", 0, (config) => config, 2);
  let brokerCreated = false;
  let providerReleased = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => { providerReleased = true; }),
        createBroker: (options) => { brokerCreated = true; return registrationFailingBroker(options); },
        sandboxProbe: () => false,
      },
    });
    assert.equal(brokerCreated, true, "valid builder-relative inversion reaches execution setup");
    assert.equal(providerReleased, false, "the fixture registration failure releases no provider process");
    assert.equal(status.budget.callsSpent, 0);
    assert.doesNotMatch(status.blocker?.detail ?? "", /InvalidReviewInversion/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("simple-sdlc rejects reviewer=B when builder=B before launch", async () => {
  const world = await fixture("simple-sdlc", 0, (config) => ({
    ...config,
    agents: config.agents.map((agent) => agent.name === "reviewer"
      ? { ...agent, model: "codex:gpt-5.6-sol", harness: { ...agent.harness, adapter: "codex" } }
      : agent),
  }), 2);
  let brokerCreated = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => assert.fail("provider released")),
        createBroker: (options) => { brokerCreated = true; return registrationFailingBroker(options); },
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.match(status.blocker?.detail ?? "", /InvalidReviewInversion/);
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(brokerCreated, false, "invalid inversion fails before process setup");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("build-review still accepts builder=A, reviewer=B before launch", async () => {
  const world = await fixture("build-review", 0, (config) => ({
    ...config,
    agents: config.agents.map((agent) => {
      if (agent.name === "builder") {
        return { ...agent, model: "claude:opus", harness: { ...agent.harness, adapter: "claude" } };
      }
      if (agent.name === "reviewer") {
        return { ...agent, model: "codex:gpt-5.6-sol", harness: { ...agent.harness, adapter: "codex" } };
      }
      return agent;
    }),
  }), 2);
  let brokerCreated = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => assert.fail("provider released")),
        createBroker: (options) => { brokerCreated = true; return registrationFailingBroker(options); },
        sandboxProbe: () => false,
      },
    });
    assert.equal(brokerCreated, true, "the existing opposite-provider build-review route remains valid");
    assert.equal(status.budget.callsSpent, 0);
    assert.doesNotMatch(status.blocker?.detail ?? "", /InvalidReviewInversion/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("unavailable configured adapter blocks before provider launch", async () => {
  const world = await fixture("build");
  let launches = 0;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: { adapterFor: (_entry: AdapterEntry, id: string) => new UnavailableAdapter(id, prepared.worktree!, () => { launches += 1; }) },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(launches, 0);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("configured continuity mismatch fails closed before broker creation or provider launch", async () => {
  const world = await fixture("build", 0, (config) => withBuilderContinuity(config, "same-session"));
  let brokerCreated = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => assert.fail("provider launched")),
        createBroker: (options) => { brokerCreated = true; return new ProcessTransportBroker(options); },
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(brokerCreated, false);
    assert.match(status.blocker?.detail ?? "", /ProductionContinuityMismatch/);
    assert.match(status.blocker?.detail ?? "", /same-session.*none/);
    const journal = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    assert.equal(journal.includes('"type":"process"'), false);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("configured none on a CAPABLE adapter is a narrowing the owner may make, not a mismatch", async () => {
  // The continuity check is one-way by design. Asking for more than the route
  // can do is a mismatch; asking for less is the owner declining a capability,
  // and the standing example is the reviewer — a reviewer that could be
  // corrected is a reviewer that could be argued with. The earlier two-way check
  // was right only while `none` was the only truth an adapter could tell.
  const world = await fixture("build");
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new SameSessionAdapter(id, prepared.worktree!, () => {}),
        createBroker: fakeBroker, sandboxProbe: () => false,
      },
    });
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.callsSpent, 1);
    // And it really did decline: no conversation was opened, so nothing private
    // was written for a route that will never be re-entered.
    assert.equal(existsSync(join(world.created.attemptDir, "private", "continuity.json")), false);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("a route that CLAIMS same-session correction without the transport is refused before any launch", async () => {
  // The two halves of the continuity contract are separate assertions, and this
  // is the case that separation exists for: pilot 2 stopped because a
  // declaration and a transport had drifted apart, so a `getModelInfo` claim
  // alone may never authorize a correction.
  const world = await fixture("build", 0, (config) => withBuilderContinuity(config, "same-session"));
  let brokerCreated = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new SameSessionAdapter(id, prepared.worktree!, () => assert.fail("provider launched")),
        createBroker: (options) => { brokerCreated = true; return new ProcessTransportBroker(options); },
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(brokerCreated, false);
    assert.match(status.blocker?.detail ?? "", /implements no correction transport/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("registration failure refunds the held call and blocks without provider execution", async () => {
  const world = await fixture("build");
  let providerRan = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => { providerRan = true; }),
        createBroker: registrationFailingBroker, sandboxProbe: () => false,
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.callsSpent, 0);
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(providerRan, false);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("immutable candidate hygiene blocks Markdown trailing spaces before configured commands", async () => {
  const world = await fixture("build");
  let configuredCommandRan = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project, assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}, "hygiene"),
        createBroker: fakeBroker, sandboxProbe: () => false,
        runCommand: (_executable, argv) => {
          if (argv[0] === "--version") throw new Error("quota probe unavailable in this offline journey");
          configuredCommandRan = true;
          throw new Error("configured command must not run after structural hygiene fails");
        },
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.blocker?.code, "phase-abort");
    assert.equal(configuredCommandRan, false);
    assert.match(status.blocker?.detail ?? "", /candidate_hygiene|CandidateHygiene|PhaseGateFailure/);
    assert.ok(status.candidateSha !== null);
    assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), status.candidateSha);
    assert.equal(git(prepared.worktree!, "status", "--porcelain"), "");
    assert.equal(git(world.canonical, "status", "--porcelain"), "");
    const db = openDatabase(join(world.stateRoot, "awsf.db"), { readonly: true });
    try {
      const hygiene = gatesForSession(db, status.sessionId).find((gate) => gate.gate_id === "candidate_hygiene");
      assert.equal(hygiene?.candidate_sha, status.candidateSha);
      assert.equal(hygiene?.passed, 0);
      assert.match(hygiene?.violations_json ?? "", /generated\.md:1: trailing whitespace/);
    } finally { db.close(); }
    assert.equal(git(prepared.worktree!, "rev-parse", "HEAD"), status.candidateSha, "failed hygiene retains the exact candidate");
    assert.equal(git(prepared.worktree!, "status", "--porcelain"), "", "hygiene leaves the candidate worktree clean");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("configured command failure retains exact evidence and blocks", async () => {
  const world = await fixture("build", 7);
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project, assertLaunchProjection: world.projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => {}),
        createBroker: fakeBroker, sandboxProbe: () => false,
      },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.match(status.blocker?.detail ?? "", /configured command phase failed/);
    assert.equal(status.budget.callsReserved, 0);
    const journal = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    assert.match(journal, /process\.exit\(7\)/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("projector degradation holds successful work at GATING rather than killing its provider", async () => {
  const world = await fixture("build");
  let providerCompleted = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath,
      projectRecord: world.projection.project, assertLaunchProjection: world.projection.assertLaunchPermitted,
      assertAdvancement: (_sessionId, to) => { if (to === "AWAITING_OWNER") throw new Error("fixture degraded projection hold"); },
      infrastructure: {
        adapterFor: (_entry: AdapterEntry, id: string) => new ScriptedAdapter(id, prepared.worktree!, () => { providerCompleted = true; }),
        createBroker: fakeBroker, sandboxProbe: () => false,
      },
    });
    assert.equal(providerCompleted, true);
    assert.equal(status.lifecycleState, "GATING");
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(status.blocker?.code, "sqlite-projection-failed");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("rerunning an exited legacy review settles the stale REVIEWING attempt to a retryable blocker", async () => {
  const world = await fixture("build-review", 0, (config) => config, 2);
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    const at = "2026-08-30T12:00:00.000Z";
    const evidence = {
      type: "gate",
      id: `${prepared.sessionId}:reviewer:0:verdict_consistent`,
      phaseId: `${prepared.sessionId}:reviewer`,
      round: 0,
      gateId: "verdict_consistent",
      kind: "pure",
      candidateSha: null,
      passed: false,
      exitCode: null,
      checks: [{ item: "findings state a concrete consequence", ok: false, note: "missing consequence: advisory-1" }],
      violations: ["findings state a concrete consequence: missing consequence: advisory-1"],
      outputPath: null,
      startedAt: at,
      endedAt: at,
    } satisfies AttemptEvidence;
    const reviewing = await persistAttempt(world.created.attemptDir, prepared.revision, {
      kind: "attempt.updated",
      evidence,
      next: nextRevision(prepared, {
        lifecycleState: "REVIEWING",
        phase: { name: "reviewer", state: "VALIDATING", round: 0, maximumRounds: 1 },
        process: null,
        blocker: null,
        budget: { ...prepared.budget, callsSpent: 2, callsReserved: 0 },
        lastActivityAt: at,
        lastActivity: "reviewer process exited before phase settlement",
        nextAction: "wait for the mandatory review",
      }),
    });
    await persistAttempt(world.created.attemptDir, reviewing.revision, {
      kind: "attempt.updated",
      evidence: {
        type: "process",
        phaseId: `${prepared.sessionId}:reviewer`,
        adapterId: "claude",
        role: "reviewer",
        record: {
          identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
          runId: `${prepared.sessionId}:reviewer:run`,
          edge: "L11",
          reservationId: "fixture-review-reservation",
          command: ["/usr/bin/node", "-e", ""],
          cwd: prepared.worktree!,
        },
        status: "EXITED",
        registeredAt: at,
        releasedAt: at,
        endedAt: at,
        exitCode: 0,
        exitSignal: null,
      },
      next: nextRevision(reviewing, {}),
    });

    let routeResolved = false;
    const recovered = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      infrastructure: { adapterFor: () => { routeResolved = true; return null; } },
    });
    assert.equal(routeResolved, false, "recovery spends no provider call and resolves no route");
    assert.equal(recovered.lifecycleState, "BLOCKED");
    assert.equal(recovered.blocker?.code, "review-malformed");
    assert.match(recovered.blocker?.detail ?? "", /missing consequence: advisory-1/);
    assert.match(recovered.nextAction, /awsf retry/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("production refuses a current config that differs from durable attempt evidence", async () => {
  const world = await fixture("build");
  let routeResolved = false;
  try {
    const changedConfig: AwsfConfig = {
      ...world.config,
      gates: { ...world.config.gates, lint: { argv: ["node", "-e", "process.exit(0)"], timeout_seconds: 10 } },
    };
    const before = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    await assert.rejects(
      runProductionCommand({
        attemptDir: world.created.attemptDir, stateRoot: world.stateRoot,
        config: changedConfig,
        configPath: world.configPath,
        infrastructure: { adapterFor: () => { routeResolved = true; return null; } },
      }),
      ProductionConfigSnapshotMismatch,
    );
    assert.equal(routeResolved, false);
    assert.equal(readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8"), before);
    assert.equal((await readAttempt(world.created.attemptDir)).lifecycleState, "PREPARED");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("production rejects a prepared worktree identity change before adapter resolution or provider launch", async () => {
  const world = await fixture("build");
  let routeResolved = false;
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    writeFileSync(join(prepared.worktree!, "README.md"), "base\nchanged outside AWSF\n");
    git(prepared.worktree!, "add", "README.md");
    git(prepared.worktree!, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: move prepared head");

    const status = await runProductionCommand({
      attemptDir: world.created.attemptDir,
      stateRoot: world.stateRoot,
      config: world.config,
      configPath: world.configPath,
      infrastructure: { adapterFor: () => { routeResolved = true; return null; } },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(routeResolved, false);
    assert.equal(status.budget.callsSpent, 0);
    assert.match(status.blocker?.detail ?? "", /prepared repository identity mismatch.*PREPARED HEAD/);
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("unsupported production workflow fails before lifecycle mutation", async () => {
  const world = await fixture("build");
  try {
    const prepared = await readAttempt(world.created.attemptDir);
    await persistAttempt(world.created.attemptDir, prepared.revision, {
      kind: "attempt.updated",
      next: nextRevision(prepared, { workflow: "unregistered-workflow" }),
    }, world.projection.project);
    const before = readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8");
    await assert.rejects(runProductionCommand({ attemptDir: world.created.attemptDir, stateRoot: world.stateRoot, config: world.config, configPath: world.configPath }), ProductionWorkflowUnsupported);
    assert.equal(readFileSync(join(world.created.attemptDir, "journal.jsonl"), "utf8"), before);
    assert.equal((await readAttempt(world.created.attemptDir)).lifecycleState, "PREPARED");
  } finally {
    world.projection.close();
    rmSync(world.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A1's regression boundary, on every enabled recipe rather than on one.
//
// The owner's request reaching the first agent is the single most damaging
// failure this factory has had: `simple-sdlc`'s planner ran with
// `Previous phase envelope: null`, planned the one defect it had evidence for —
// its own empty input — and the builder implemented that. `1755/1755` was green
// throughout. The runner fix is uniform, so the class is closed structurally;
// this is the boundary that says so for each route, because a change that keeps
// the phase list and drops the `recordedRequest` argument on some of them would
// otherwise be caught for `simple-sdlc` alone.
//
// It does not need a full drive per recipe. The first agent phase's composed
// prompt is captured and the run is then allowed to go wherever it goes.
// ---------------------------------------------------------------------------

for (const recipe of WORKFLOW_RECIPES) {
  test(`production ${recipe.id} composes the owner's recorded request into its first agent prompt`, async () => {
    const request = `carry this verbatim into ${recipe.id}'s first agent`;
    // Two routes need more than the generic fixture supplies, and neither has
    // anything to do with A1: `intake` is the one configured `same-session`
    // agent and the scripted adapter reports `none`; `design-to-plan`'s host
    // head reads the project catalog off the canonical repository.
    const world = await fixture(
      recipe.id as Parameters<typeof fixture>[0],
      0,
      (config) => recipe.id !== "intake" ? config : {
        ...config,
        agents: config.agents.map((agent) => agent.name === "intake"
          ? { ...agent, harness: { ...agent.harness, continuity: "none" as const } }
          : agent),
      },
      recipe.tier,
      request,
      (canonical) => {
        if (recipe.id !== "design-to-plan") return;
        writeFileSync(join(canonical, "awsf.project.yaml"), [
          "version: awsf.project/v1",
          "project:",
          "  slug: agentic-workflow-software-factory",
          "repositories:",
          "  primary:",
          "    role: plan",
          "    default_branch: main",
          "plans:",
          "  root: specs",
          "  format: awsf-plan-html/v1",
          "",
        ].join("\n"));
        git(canonical, "add", "awsf.project.yaml");
        git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "chore: declare the project catalog");
      },
    );
    try {
      if (recipe.id === "design-to-plan") {
        await writePlacement(world.stateRoot, world.config.project.slug, {
          version: "awsf.placement/v1",
          project: world.config.project.slug,
          repositories: { primary: { path: world.canonical } },
          worktree_root: join(world.root, "worktrees"),
        });
      }
      const prepared = await readAttempt(world.created.attemptDir);
      const prompts: string[] = [];
      // The blocker, when there is one, is what makes a failure here readable.
      let outcome = "the run threw";
      try {
        outcome = JSON.stringify((await runProductionCommand({
          attemptDir: world.created.attemptDir,
          stateRoot: world.stateRoot,
          config: world.config,
          configPath: world.configPath,
          projectRecord: world.projection.project,
          assertAdvancement: world.projection.assertAdvancement,
          assertLaunchProjection: world.projection.assertLaunchPermitted,
          infrastructure: {
            adapterFor: (_entry: AdapterEntry, id: string) =>
              new ScriptedAdapter(id, prepared.worktree!, (r) => prompts.push(r.prompt)),
            createBroker: fakeBroker,
            sandboxProbe: () => false,
          },
        })).blocker);
      } catch (error) {
        // Where the run ends is another test's subject. This one is about the
        // first thing the first agent was told.
        if (prompts.length === 0) throw error;
      }
      const first = recipe.phases.find((phase) => phase.kind === "agent");
      assert.ok(first, `${recipe.id} has an agent phase`);
      assert.ok(prompts.length > 0, `${recipe.id} never launched its ${first.id} phase: ${outcome}`);
      assert.ok(
        prompts[0]!.includes(`Owner-recorded request (verbatim):\n${request}\n`),
        `${recipe.id}: ${first.id} was composed without the recorded request`,
      );
      assert.equal(prepared.request, request);
    } finally {
      world.projection.close();
      rmSync(world.root, { recursive: true, force: true });
    }
  });
}

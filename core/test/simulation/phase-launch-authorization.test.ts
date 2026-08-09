import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StubAdapter } from "../../src/adapters/stub.ts";
import type { AgentPhaseProcessRegistration } from "../../src/adapters/interface.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import { ProcessTransportBroker } from "../../src/execution/transport-broker.ts";
import type { BarrierRecord } from "../../src/execution/launcher-barrier.ts";
import { compileWorkflow } from "../../src/workflow/compiler.ts";
import { createCompiledPhaseLaunchVerifier } from "../../src/workflow/phase-launch-authorization.ts";
import { planBuildTestWorkflow } from "../../src/workflow/recipes/plan-build-test.ts";

const PROVIDER = join(import.meta.dirname, "..", "fixtures", "providers", "stub", "stub-provider.mjs");

test("a valid second agent phase starts a real process and converts its held reservation on GO", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-phase-positive-"));
  const sideEffect = join(root, "second-agent-ran.json");
  try {
    const compiled = compileWorkflow(planBuildTestWorkflow, 1);
    const budget = new CallBudget({ taskId: "phase-positive", tier: 1 });
    // The planner was the first provider and was authorized by durable L4.
    const first = budget.reserve({ cost: 1, edge: "L4", subject: "first provider through L4" });
    budget.spendOnGo(first.id);
    const second = budget.reserve({ cost: 1, subject: "builder: second ordinary agent phase" });
    const records: BarrierRecord[] = [];
    const verifier = createCompiledPhaseLaunchVerifier({
      statusFor: (taskSessionId) => ({
        taskSessionId,
        lifecycleState: "RUNNING",
        workflowId: compiled.id,
      }),
      compiledWorkflowFor: () => compiled,
      configuredRouteFor: () => ({
        adapterId: "stub-config",
        role: "builder",
        launchAuthorization: "agent-phase",
      }),
    });
    const broker = new ProcessTransportBroker({
      register: async (record) => { records.push(record); },
      ledger: budget,
      phaseLaunchVerifier: verifier,
    });
    const adapter = new StubAdapter({ providerPath: PROVIDER, sideEffectPath: sideEffect });
    const registration: AgentPhaseProcessRegistration = {
      kind: "agent-phase",
      runId: "run-builder-second-agent",
      taskSessionId: "task-session-positive",
      workflowId: compiled.id,
      phaseId: "builder",
      phaseOrdinal: 3,
      reservationId: second.id,
      adapterId: "stub-config",
      role: "builder",
    };
    const transport = await broker.startProcess(
      registration,
      adapter.buildSpec({
        model: "stub/success",
        prompt: "execute the second compiled agent phase",
        cwd: root,
        env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
      }),
      new AbortController().signal,
    );
    const kinds: string[] = [];
    for await (const event of adapter.parse(transport)) kinds.push(event.kind);
    const exit = await transport.exit;

    assert.equal(exit.code, 0);
    assert.equal(existsSync(sideEffect), true, "the positive control must prove a provider really ran");
    assert.deepEqual(kinds, ["run.started", "model.resolved", "text.delta", "run.completed"]);
    assert.equal(budget.callsSpent, 2, "L4 and the later phase each spend exactly one call on GO");
    assert.equal(budget.callsReserved, 0);
    assert.equal(budget.reservation(second.id)?.state, "spent");
    assert.equal(records.length, 1);
    assert.equal(records[0]?.edge, null, "an agent phase is not disguised as a task edge");
    assert.deepEqual(records[0]?.phase, {
      taskSessionId: "task-session-positive",
      workflowId: "plan-build-test",
      phaseId: "builder",
      phaseOrdinal: 3,
      adapterId: "stub-config",
      role: "builder",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

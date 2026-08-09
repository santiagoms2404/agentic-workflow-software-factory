// Agent-phase authorization is separate from the five task-edge spawn sites.
// Every refusal below points the broker at a launcher that writes a sentinel as
// its first instruction. Absence of that file proves authorization failed
// before child creation, not merely before provider release.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentPhaseLaunchVerifier,
  AgentPhaseProcessRegistration,
  ProcessSpec,
} from "../../../src/adapters/interface.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import {
  ProcessTransportBroker,
  SpawnRegistrationInvalid,
} from "../../../src/execution/transport-broker.ts";
import { compileWorkflow, type CompiledWorkflow } from "../../../src/workflow/compiler.ts";
import {
  PhaseLaunchAuthorizationRejected,
  createCompiledPhaseLaunchVerifier,
  type ConfiguredPhaseRoute,
} from "../../../src/workflow/phase-launch-authorization.ts";
import { planBuildTestWorkflow } from "../../../src/workflow/recipes/plan-build-test.ts";
import { buildReviewWorkflow } from "../../../src/workflow/recipes/build-review.ts";
import type { TaskState } from "../../../src/state/task-machine.ts";

interface World {
  state: TaskState;
  durableWorkflowId: string;
  compiled: CompiledWorkflow | null;
  route: ConfiguredPhaseRoute | null;
}

const spec: ProcessSpec = {
  executable: "/bin/true",
  argv: [],
  cwd: tmpdir(),
  env: { PATH: "/bin:/usr/bin" },
  stdin: "phase prompt",
  shell: false,
};

function registration(reservationId: string): AgentPhaseProcessRegistration {
  return {
    kind: "agent-phase",
    runId: "run-builder-2",
    taskSessionId: "task-session-1",
    workflowId: "plan-build-test",
    phaseId: "builder",
    phaseOrdinal: 3,
    reservationId,
    adapterId: "configured-stub",
    role: "builder",
  };
}

function verifier(world: World): AgentPhaseLaunchVerifier {
  return createCompiledPhaseLaunchVerifier({
    statusFor: (taskSessionId) => taskSessionId === "task-session-1"
      ? { taskSessionId, lifecycleState: world.state, workflowId: world.durableWorkflowId }
      : null,
    compiledWorkflowFor: () => world.compiled,
    configuredRouteFor: () => world.route,
  });
}

function phaseRejection(error: unknown): PhaseLaunchAuthorizationRejected {
  if (!(error instanceof PhaseLaunchAuthorizationRejected)) {
    throw new Error(`expected PhaseLaunchAuthorizationRejected, got ${String(error)}`);
  }
  return error;
}

function shapeRejection(error: unknown): SpawnRegistrationInvalid {
  if (!(error instanceof SpawnRegistrationInvalid)) {
    throw new Error(`expected SpawnRegistrationInvalid, got ${String(error)}`);
  }
  return error;
}

async function refusedBeforeChild(options: {
  mutate?: (world: World, value: AgentPhaseProcessRegistration) => AgentPhaseProcessRegistration;
  verifier?: (world: World) => AgentPhaseLaunchVerifier | undefined;
}): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "awsf-phase-auth-"));
  const marker = join(dir, "child-existed");
  const launcherPath = join(dir, "sentinel.mjs");
  writeFileSync(launcherPath, `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "yes");\n`);
  try {
    const budget = new CallBudget({ taskId: "phase-auth", tier: 2, carried: { callsSpent: 1 } });
    const held = budget.reserve({ cost: 1, subject: "second agent phase" });
    const world: World = {
      state: "RUNNING",
      durableWorkflowId: "plan-build-test",
      compiled: compileWorkflow(planBuildTestWorkflow, 1),
      route: { adapterId: "configured-stub", role: "builder", launchAuthorization: "agent-phase" },
    };
    const value = options.mutate?.(world, registration(held.id)) ?? registration(held.id);
    const hostVerifier = options.verifier === undefined ? verifier(world) : options.verifier(world);
    const broker = new ProcessTransportBroker({
      register: async () => {},
      ledger: budget,
      launcherPath,
      handshakeMs: 100,
      ...(hostVerifier === undefined ? {} : { phaseLaunchVerifier: hostVerifier }),
    });
    const error = await broker.startProcess(value, spec, new AbortController().signal).then(
      () => null,
      (caught: unknown) => caught,
    );
    assert.notEqual(error, null, "the malformed phase authorization unexpectedly launched");
    assert.equal(existsSync(marker), false, "authorization was rejected only after a child existed");
    assert.equal(budget.reservation(held.id)?.state, "held", "a pre-spawn refusal does not settle money");
    return error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("real sentinel sweep rejects wrong task state, unknown/local phases, identity mismatch, and reservations", async () => {
  const cases: Array<{
    label: string;
    mutate: NonNullable<Parameters<typeof refusedBeforeChild>[0]["mutate"]>;
  }> = [
    { label: "wrong task state", mutate: (world, value) => { world.state = "GATING"; return value; } },
    { label: "unknown phase", mutate: (_world, value) => ({ ...value, phaseId: "missing", phaseOrdinal: 99 }) },
    { label: "local engineer phase", mutate: (_world, value) => ({ ...value, phaseId: "request", phaseOrdinal: 1, role: "engineer" }) },
    { label: "local code phase", mutate: (_world, value) => ({ ...value, phaseId: "tests", phaseOrdinal: 4, role: "host" }) },
    { label: "mismatched durable workflow", mutate: (world, value) => { world.durableWorkflowId = "build"; return value; } },
    { label: "mismatched phase identity", mutate: (_world, value) => ({ ...value, phaseId: "planner" }) },
    { label: "missing reservation", mutate: (_world, value) => ({ ...value, reservationId: "" }) },
    { label: "unknown reservation", mutate: (_world, value) => ({ ...value, reservationId: "r-does-not-exist" }) },
    { label: "malformed ordinal", mutate: (_world, value) => ({ ...value, phaseOrdinal: "3" as unknown as number }) },
    { label: "provider outside config", mutate: (_world, value) => ({ ...value, adapterId: "caller-selected" }) },
  ];
  for (const item of cases) {
    const error = await refusedBeforeChild({ mutate: item.mutate });
    assert.ok(
      error instanceof PhaseLaunchAuthorizationRejected || error instanceof SpawnRegistrationInvalid,
      `${item.label}: ${String(error)}`,
    );
  }
});

test("mandatory review and owner-rework routes cannot be converted into phase authorizations", async () => {
  const error = await refusedBeforeChild({
    mutate: (world, value) => {
      world.compiled = compileWorkflow(buildReviewWorkflow, 2);
      world.durableWorkflowId = "build-review";
      world.route = { adapterId: "configured-stub", role: "reviewer", launchAuthorization: "task-edge" };
      return {
        ...value,
        workflowId: "build-review",
        phaseId: "reviewer",
        phaseOrdinal: 4,
        role: "reviewer",
      };
    },
  });
  assert.match(phaseRejection(error).message, /task-edge launch/);

  const rework = await refusedBeforeChild({
    mutate: (world, value) => {
      world.route = { adapterId: "configured-stub", role: "builder", launchAuthorization: "task-edge" };
      return value;
    },
  });
  assert.match(phaseRejection(rework).message, /task-edge launch/);
});

test("REVIEWING durable state cannot authorize a compiled phase launch", async () => {
  const error = await refusedBeforeChild({
    mutate: (world, value) => { world.state = "REVIEWING"; return value; },
  });
  assert.match(phaseRejection(error).message, /not RUNNING/);
});

test("the broker rejects phase registrations when the trusted host verifier is absent or equivocates", async () => {
  const absent = await refusedBeforeChild({ verifier: () => undefined });
  assert.match(shapeRejection(absent).message, /trusted host verifier is not installed/);

  const equivocating = await refusedBeforeChild({
    verifier: () => ({
      verify: (value) => ({
        taskSessionId: value.taskSessionId,
        taskState: "RUNNING",
        workflowId: value.workflowId,
        phaseId: value.phaseId,
        phaseOrdinal: value.phaseOrdinal,
        phaseKind: "agent",
        adapterId: "different-adapter",
        role: value.role,
        launchAuthorization: "agent-phase",
      }),
    }),
  });
  assert.match(shapeRejection(equivocating).message, /different launch/);
});

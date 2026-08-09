import assert from "node:assert/strict";
import { test } from "node:test";
import type { BuildOutput } from "../../../src/contracts/build-output.ts";
import { BuildOutputSchema } from "../../../src/contracts/build-output.ts";
import type { TokenUsage } from "../../../src/contracts/normalized-events.ts";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { GateReport } from "../../../src/gates/interface.ts";
import { PermissionBreach } from "../../../src/policy/path-policy.ts";
import type { PhaseState } from "../../../src/state/phase-machine.ts";
import { compilePhase } from "../../../src/workflow/compiler.ts";
import {
  CorrectionIdentityMismatch,
  CorrectionTransportFailure,
  type AgentTurn,
  type CorrectionSession,
} from "../../../src/workflow/corrections.ts";
import {
  EnvelopeValidationFailure,
  runAgentPhase,
  type EnvelopePersistence,
  type RunAgentPhaseOptions,
} from "../../../src/workflow/engine.ts";
import type { AgentPhaseDefinition, CompiledAgentPhase } from "../../../src/workflow/phase.ts";

const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({
  inputTokens,
  outputTokens,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
  reasoningRelation: "unknown",
});

const identity = { adapter: "fixture", provider: "stub", model: "stub/correct", sessionId: "provider-s1" };

function payload(summary = "done"): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary,
    artifacts: [{ path: "src/change.ts", kind: "source", description: "implemented change" }],
    notesForNextPhase: "run tests",
    changedFiles: ["src/change.ts"],
    implementationNotes: ["implemented"],
    commandsRun: [{ argv: ["npm", "test"], exitCode: 0 }],
    proposedCommitMessage: "feat: implement change",
  };
}

function turn(rawOutput: string, input = 10, output = 5, id = identity): AgentTurn {
  return { identity: id, rawOutput, usage: usage(input, output), costUsd: 0.01 };
}

class ScriptedSession implements CorrectionSession {
  readonly identity = identity;
  readonly prompts: string[] = [];
  readonly #turns: (AgentTurn | Error)[];

  constructor(turns: (AgentTurn | Error)[]) {
    this.#turns = [...turns];
  }

  async send(prompt: string): Promise<AgentTurn> {
    this.prompts.push(prompt);
    const next = this.#turns.shift();
    if (next === undefined) throw new Error("unexpected send");
    if (next instanceof Error) throw next;
    return next;
  }
}

function compiled(gate: AgentPhaseDefinition<BuildOutput>["gates"]): CompiledAgentPhase<BuildOutput> {
  const result = compilePhase<BuildOutput>({
    id: "builder",
    kind: "agent",
    owner: "builder-agent",
    description: "Implement the requested behavior and report the exact changed paths",
    schemaId: "awsf.build-output/v1",
    outputSchema: BuildOutputSchema,
    maxCorrections: 1,
    gates: gate,
    prompt: "Build it.\n{previous_envelope}\n{output_schema}",
  });
  if (result.kind !== "agent") throw new Error("expected agent phase");
  return result;
}

function options(
  session: CorrectionSession,
  phase: CompiledAgentPhase<BuildOutput>,
  persistence: EnvelopePersistence,
  overrides: Partial<RunAgentPhaseOptions<BuildOutput>> = {},
): RunAgentPhaseOptions<BuildOutput> {
  return {
    workflowId: "build",
    phase,
    worktree: "/tmp/worktree",
    previousEnvelope: null,
    session,
    budget: new CallBudget({ taskId: "T19", tier: 1 }),
    permissions: { enforce: () => ({ changedPaths: ["src/change.ts"], sandboxBadge: "tool-policy" }) },
    hostGit: {
      captureDiff: () => ["src/change.ts"],
      commit: () => "candidate-sha",
    },
    persistence,
    agentSessionId: "agent-session-1",
    now: () => "2026-08-08T12:00:00.000Z",
    ...overrides,
  };
}

test("gate correction stays in-session, is call-neutral, bounds evidence, and accounts usage", async () => {
  let gateRuns = 0;
  const order: string[] = [];
  const gate = {
    id: "commands_pass",
    run: () => {
      order.push(`gate-${gateRuns}`);
      const report = new GateReport("commands_pass");
      report.check("tests", gateRuns++ > 0, "x".repeat(5_000));
      return report;
    },
  };
  const session = new ScriptedSession([
    turn(JSON.stringify(payload("first")), 10, 5),
    turn(JSON.stringify(payload("fixed")), 12, 7),
  ]);
  const stored: unknown[] = [];
  const budget = new CallBudget({ taskId: "T19", tier: 1, carried: { callsSpent: 1 } });
  const result = await runAgentPhase(options(session, compiled([gate]), {
    persist: (envelope) => { stored.push(envelope); },
  }, {
    budget,
    permissions: { enforce: () => { order.push("permissions"); return { changedPaths: ["src/change.ts"], sandboxBadge: "tool-policy" }; } },
    hostGit: {
      captureDiff: () => { order.push("capture"); return ["src/change.ts"]; },
      commit: () => { order.push("commit"); return "candidate-sha"; },
    },
  }));

  assert.equal(result.state, "SUCCEEDED");
  assert.equal(session.prompts.length, 2);
  assert.equal(budget.callsSpent, 1, "same-session turns must not spend or reserve tier calls");
  assert.equal(budget.callsReserved, 0);
  assert.equal(budget.snapshot().correctionsAuto, 1);
  assert.deepEqual(order, ["gate-0", "gate-1", "permissions", "capture", "commit"]);
  assert.equal(stored.length, 2);
  assert.match(session.prompts[1]!, /"phase": "builder"/);
  assert.match(session.prompts[1]!, /"round": 1/);
  assert.match(session.prompts[1]!, /"previousEnvelopeRef": "agent-session-1:builder:0"/);
  assert.match(session.prompts[1]!, /"remainingCallBudget": 2/);
  assert.ok(session.prompts[1]!.includes("x".repeat(4_000)));
  assert.ok(!session.prompts[1]!.includes("x".repeat(4_001)));
  assert.equal(result.usage.spend.inputTokens, 22);
  assert.equal(result.usage.spend.outputTokens, 12);
  assert.equal(result.usage.contextOccupancy.inputTokens, 12);
  assert.equal(result.usage.contextOccupancy.outputTokens, 7);
  assert.equal(result.usage.costUsd, 0.02);
  assert.equal(result.candidateSha, "candidate-sha");
});

test("at most two in-session parse fixes are attempted and every invalid envelope is retained", async () => {
  const session = new ScriptedSession([turn("not json"), turn("[]"), turn('{"schema":"wrong"}')]);
  const stored: { valid: boolean; violations: unknown[] }[] = [];
  const budget = new CallBudget({ taskId: "T19", tier: 1, allowance: { auto: 2, owner: 0 } });
  await assert.rejects(
    runAgentPhase(options(session, compiled([]), {
      persist: (envelope) => { stored.push(envelope); },
    }, { budget })),
    (error: Error) => error instanceof EnvelopeValidationFailure && error.envelopes.length === 3,
  );
  assert.equal(session.prompts.length, 3, "one send plus no more than two JSON-fix sends");
  assert.equal(stored.length, 3);
  assert.ok(stored.every((envelope) => !envelope.valid && envelope.violations.length > 0));
  assert.equal(budget.callsSpent, 0);
});

test("correction identity is asserted across adapter, provider, model, and provider session", async () => {
  let gateRuns = 0;
  const gate = {
    id: "envelope_valid",
    run: () => new GateReport("envelope_valid").check("forced", gateRuns++ > 0, "retry"),
  };
  const changed = { ...identity, sessionId: "provider-s2" };
  const session = new ScriptedSession([turn(JSON.stringify(payload())), turn(JSON.stringify(payload()), 1, 1, changed)]);
  await assert.rejects(
    runAgentPhase(options(session, compiled([gate]), { persist: () => undefined })),
    (error: Error) => error instanceof CorrectionIdentityMismatch && error.differences.some((item) => item.includes("sessionId")),
  );
});

test("a correction transport failure aborts and cannot cold-restart the session", async () => {
  const gate = {
    id: "envelope_valid",
    run: () => new GateReport("envelope_valid").check("forced", false, "retry"),
  };
  const session = new ScriptedSession([turn(JSON.stringify(payload())), new Error("pipe closed")]);
  const budget = new CallBudget({ taskId: "T19", tier: 1, carried: { callsSpent: 1 } });
  const states: PhaseState[] = [];
  await assert.rejects(
    runAgentPhase(options(session, compiled([gate]), { persist: () => undefined }, {
      budget,
      onPhaseState: (state) => { states.push(state); },
    })),
    (error: Error) => error instanceof CorrectionTransportFailure && error.coldRestartAttempted === false,
  );
  assert.equal(session.prompts.length, 2);
  assert.equal(budget.callsSpent, 1);
  assert.equal(budget.callsReserved, 0);
  assert.equal(states[0], "QUEUED");
  assert.equal(states.at(-1), "FAILED");
});

test("permission enforcement happens after clean gates and a breach aborts without correction", async () => {
  const gate = {
    id: "envelope_valid",
    run: () => new GateReport("envelope_valid").check("valid", true, "valid"),
  };
  const session = new ScriptedSession([turn(JSON.stringify(payload()))]);
  await assert.rejects(
    runAgentPhase(options(session, compiled([gate]), { persist: () => undefined }, {
      permissions: {
        enforce: () => { throw new PermissionBreach([{ path: "AGENTS.md", reasons: ["outside-write-globs"] }]); },
      },
      hostGit: {
        captureDiff: () => { throw new Error("must not capture after breach"); },
        commit: () => { throw new Error("must not commit after breach"); },
      },
    })),
    (error: Error) => error instanceof PermissionBreach && error.offendingPaths.includes("AGENTS.md"),
  );
  assert.equal(session.prompts.length, 1);
});

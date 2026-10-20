import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test, mock } from "node:test";
import { fileURLToPath } from "node:url";
import type { BrokerProcessRegistration, ModelRequest, TransportBroker } from "../../../src/adapters/interface.ts";
import type { NormalizedEvent, RunErrorCode } from "../../../src/contracts/normalized-events.ts";
import type { BuildOutput } from "../../../src/contracts/build-output.ts";
import type { TransitionInput } from "../../../src/state/task-machine.ts";

const scenarios = ["two transport failures", "transport then quota", "quota without retry"] as const;
type Scenario = typeof scenarios[number];

async function exercise(scenario: Scenario): Promise<void> {
  // Observe the actual L17 input, not a copy of the runner's retry predicate.
  // The counter is passed to the guard; the durable transition row does not
  // retain this field, despite the original finding calling it journaled.
  const machine = await import("../../../src/state/task-machine.ts");
  const blocked: TransitionInput[] = [];
  mock.module("../../../src/state/task-machine.ts", { namedExports: { ...machine,
    transition: (input: TransitionInput) => {
      if (input.from === "REVIEWING" && input.to === "BLOCKED") blocked.push(input);
      return machine.transition(input);
    },
  } });
  const { AT, ReplayStub, box, draft, prepare, run, start } = await import("../../fixtures/trap-world.ts");
  const { readAttemptEvidence } = await import("../../../src/cli/commands/review-record.ts");
  let reviews = 0;
  class ReviewFaultStub extends ReplayStub {
    override async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
      signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
      await broker.startProcess(registration, this.buildSpec(request), signal);
      const base = { runId: registration.runId, hostAt: AT, providerAt: null };
      yield { ...base, seq: 1, kind: "run.started", adapter: this.id, requestedModel: request.model };
      if (registration.role === "reviewer") {
        reviews++;
        const errorCode: RunErrorCode = scenario === "two transport failures" || (scenario === "transport then quota" && reviews === 1)
          ? "E_BACKEND_FAILURE" : "E_QUOTA_EXHAUSTED";
        yield { ...base, seq: 2, kind: "run.failed", errorCode, message: "offline review fault" };
        return;
      }
      const path = "core/src/example.ts";
      mkdirSync(dirname(join(request.cwd, path)), { recursive: true });
      writeFileSync(join(request.cwd, path), "export const example = 1;\n");
      const output: BuildOutput = {
        schema: "awsf.build-output/v1", producerStatus: "success", summary: "Added the requested example.",
        artifacts: [], notesForNextPhase: "Review the candidate.", changedFiles: [path], implementationNotes: [],
        commandsRun: [], proposedCommitMessage: "feat: add example",
      };
      yield { ...base, seq: 2, kind: "model.resolved", adapter: this.id, provider: (await this.getModelInfo(request.model)).provider,
        requestedModel: request.model, resolvedModel: request.model, provenance: "stream-authoritative" };
      yield { ...base, seq: 3, kind: "text.delta", text: JSON.stringify(output) };
      yield { ...base, seq: 4, kind: "run.completed", exitCode: 0 };
    }
  }
  const b = box();
  try {
    const created = await draft(b, undefined, "build-review");
    await prepare(b, created.attemptDir);
    await start(b, created.attemptDir);
    const status = await run(b, created.attemptDir, { ...b.infrastructure,
      adapterFor: (_entry: unknown, id: string) => new ReviewFaultStub(id) });
    const attempts = scenario === "quota without retry" ? 1 : 2;
    assert.equal(reviews, attempts, "only the permitted fixed-route calls execute");
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.blocker?.code, scenario === "two transport failures" ? "review-unavailable" : "quota-exhausted");
    assert.equal(status.budget.callsSpent, 1 + attempts);
    assert.equal(status.budget.callsReserved, 0);
    const transitions = (await readAttemptEvidence(created.attemptDir)).filter(row => row.type === "transition" && row.edgeId === "L17");
    assert.equal(transitions.length, 1, "the real L17 guard and persistence still run");
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]!.evidence?.reviewTransportRetries, attempts - 1,
      "L17 retry count measures retries executed, not transport failures classified");
  } finally { b.close(); mock.restoreAll(); }
}

if (process.argv.includes("--b7-15-child")) {
  await exercise(process.argv.at(-1) as Scenario);
} else {
  for (const scenario of scenarios) test(`B7-15: ${scenario} attests the actual retry count`, () => {
    // Module mocking needs an explicit Node flag. Isolate it here so the named
    // regression also runs under the repository's ordinary strip-types command.
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-test-module-mocks",
      fileURLToPath(import.meta.url), "--b7-15-child", scenario], { encoding: "utf8", timeout: 180_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
}

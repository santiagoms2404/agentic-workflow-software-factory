// S12/S14: test the proposed gap before assigning a no-trap kind. The recorded
// condition is fresh gate output, not a credential in the owner's request.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ModelRequest, TransportBroker, BrokerProcessRegistration } from "../../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import type { BuildOutput } from "../../../src/contracts/build-output.ts";
import type { AttemptEvidence } from "../../../src/observability/attempt-evidence.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { reworkCommand } from "../../../src/cli/commands/rework.ts";
import { composePromptBundle } from "../../../src/workflow/prompt-composition.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { SEEDS } from "../../../src/traps/seeds.ts";
import { k1Request } from "../../fixtures/k1-preflight.ts";
import { AT, OWNER, ReplayStub, box, commit, draft, prepare, start } from "./fixture.ts";

for (const id of ["S12", "S14"]) test(`${id}: fresh credential-shaped rework gate output is after-spend, not a pre-call retained input`, async () => {
  assert.equal(SEEDS.find(seed => seed.id === id)!.outcome, "after-spend");
  const b = box();
  try {
    const created = await draft(b, k1Request("correct literal selection and masking in the example", "core/src/example.ts"));
    await prepare(b, created.attemptDir);
    const prepared = await start(b, created.attemptDir);
    mkdirSync(join(prepared.worktree!, "core/src"), { recursive: true });
    writeFileSync(join(prepared.worktree!, "core/src/example.ts"), "export  const example = true;\n");
    const candidateSha = commit(prepared.worktree!, "test: candidate for synthetic rework");
    const phaseId = `${prepared.sessionId}:builder`;
    const payload: BuildOutput = { schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote the example",
      artifacts: [{ path: "core/src/example.ts", kind: "source", description: "synthetic source" }], changedFiles: ["core/src/example.ts"],
      notesForNextPhase: "owner inspection", implementationNotes: [], commandsRun: [], proposedCommitMessage: "test: synthetic source" };
    const bundle = await composePromptBundle({ configPath: b.configPath, agent: b.config.agents.find(agent => agent.name === "builder")! });
    const evidence: AttemptEvidence[] = [
      { type: "compiled-prompt", phaseId, name: "system", text: bundle.systemPrompt, lineCount: bundle.systemPrompt.split("\n").length,
        ...bundle.evidence, at: AT },
      { type: "agent", phaseId, agent: "builder", adapterId: "codex", provider: "openai-codex", color: null,
        requestedModel: "synthetic-model", resolvedModel: "synthetic-model", modelProvenance: "route-attributed", contextWindow: null,
        usageAuthority: "none", usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
          reasoningTokens: null, reasoningRelation: "unknown" }, contextTokens: null, costUsd: null, costAuthority: "unavailable", at: AT },
      { type: "envelope", phaseId, envelope: { schemaId: "awsf.build-output/v1", envelopeId: "synthetic-prior-build",
        sessionId: prepared.sessionId, phaseId, correctionRound: 0, agent: "builder", valid: true, violations: [], payload,
        rawOutputPath: "raw/synthetic.txt", createdAt: AT } },
    ];
    let status = prepared;
    for (const entry of evidence) status = await persistAttempt(created.attemptDir, status.revision, { kind: "attempt.updated",
      next: nextRevision(status, { candidateSha, lifecycleState: "AWAITING_OWNER" }), evidence: entry }, b.projection.project);
    const credential = ["sk", "synthetic-gate-output-12345678"].join("-");
    let commandCalls = 0;
    let submittedPrompt = "";
    const result = await reworkCommand({ attemptDir: created.attemptDir, stateRoot: b.stateRoot, config: b.config,
      configPath: b.configPath, terminal: OWNER, defect: "remove duplicate whitespace in core/src/example.ts", projectRecord: b.projection.project,
      infrastructure: { ...b.infrastructure,
        runCommand: () => {
          commandCalls++;
          assert.equal(b.calls.length, 1, "the gate cannot produce its bytes until after the rework provider call");
          return { status: 0, stdout: credential, stderr: "", error: null };
        },
        adapterFor: (_entry, adapterId) => {
          const adapter = new class extends ReplayStub {
            override async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
              signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
              submittedPrompt = request.prompt;
              await broker.startProcess(registration, this.buildSpec(request), signal);
              this.launches++;
              writeFileSync(join(request.cwd, "core/src/example.ts"), "export const example = true;\n");
              yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: AT, providerAt: null, adapter: this.id, requestedModel: request.model };
              yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: AT, providerAt: null, adapter: this.id,
                provider: "openai-codex", requestedModel: request.model, resolvedModel: request.model, provenance: "route-attributed" };
              yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: AT, providerAt: null, text: JSON.stringify(payload) };
              yield { kind: "run.completed", seq: 4, runId: registration.runId, hostAt: AT, providerAt: null, exitCode: 0 };
            }
          }(adapterId);
          b.adapters.push(adapter);
          return adapter;
        },
      } });
    assert.equal(result.status.lifecycleState, "BLOCKED");
    assert.equal(result.status.budget.callsSpent, 1);
    assert.equal(result.status.budget.callsReserved, 0);
    assert.equal(commandCalls, 1);
    assert.equal(b.calls.length, 1);
    assert.equal(submittedPrompt.includes(credential), false, "this is fresh gate output, not a carried pre-call input");
    assert.match(result.status.blocker?.detail ?? "", /configured gate output.*credential-shaped/u);
    assert.equal(JSON.stringify(await readAttemptEvidence(created.attemptDir)).includes(credential), false);
    assert.equal((await readAttempt(created.attemptDir)).lifecycleState, "BLOCKED");
  } finally { b.close(); }
});

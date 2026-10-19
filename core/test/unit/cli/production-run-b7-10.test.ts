import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrokerProcessRegistration, ModelRequest, TransportBroker } from "../../../src/adapters/interface.ts";
import { UNREPORTED_TOKEN_USAGE, type NormalizedEvent, type TokenUsage } from "../../../src/contracts/normalized-events.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { AT, ReplayStub, box, draft, prepare, run, start } from "../../fixtures/trap-world.ts";

class UsageStub extends ReplayStub {
  readonly usage: TokenUsage;
  constructor(id: string, usage: TokenUsage) { super(id); this.usage = usage; }
  override async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const base = { runId: registration.runId, hostAt: AT, providerAt: null };
    yield { ...base, seq: 1, kind: "model.resolved", adapter: this.id, provider: (await this.getModelInfo(request.model)).provider,
      requestedModel: request.model, resolvedModel: request.model, provenance: "stream-authoritative" };
    yield { ...base, seq: 2, kind: "usage", usage: this.usage };
    // Accounting precedes envelope validation; no candidate writes are needed.
    yield { ...base, seq: 3, kind: "text.delta", text: "{}" };
    yield { ...base, seq: 4, kind: "run.completed", exitCode: 0 };
  }
}

for (const [name, fields, expected] of [
  ["cached input is included", { inputTokens: 4, outputTokens: 900, cacheReadTokens: 150000, cacheWriteTokens: 2000 }, 152904],
  ["cache-only report is not unknown", { cacheReadTokens: 12, cacheWriteTokens: 3 }, 15],
  ["unknown remains null", {}, null],
  ["reported zero remains zero", { cacheReadTokens: 0 }, 0],
  ["reasoning included in output is not counted twice", { inputTokens: 10, outputTokens: 20, reasoningTokens: 15, reasoningRelation: "included-in-output" }, 30],
] satisfies [string, Partial<TokenUsage>, number | null][]) {
  test(`B7-10: ${name} in production agent evidence`, async () => {
    const usage = { ...UNREPORTED_TOKEN_USAGE, ...fields };
    const b = box(config => { config.risk.correction_allowance.auto = 0; });
    try {
      const created = await draft(b);
      await prepare(b, created.attemptDir);
      await start(b, created.attemptDir);
      const status = await run(b, created.attemptDir, { ...b.infrastructure,
        adapterFor: (_entry: unknown, id: string) => new UsageStub(id, usage) });
      assert.equal(status.lifecycleState, "BLOCKED", "the intentionally malformed envelope stops after accounting");
      const agents = (await readAttemptEvidence(created.attemptDir)).filter(row => row.type === "agent");
      assert.equal(agents.length, 2, "the initial send and bounded parse repair both report usage");
      assert.deepEqual(agents.map(row => row.usage), [usage, usage]);
      assert.deepEqual(agents.map(row => row.contextTokens), [expected, expected], "context includes separately reported cache reads and writes");
    } finally { b.close(); }
  });
}

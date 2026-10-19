import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrokerProcessRegistration, ModelInfo, ModelRequest, ObservedProviderSession, TransportBroker } from "../../../src/adapters/interface.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { UsageAccumulator, type AgentTurn } from "../../../src/workflow/corrections.ts";
import { AT, ReplayStub, box, draft, prepare, run, start } from "../../fixtures/trap-world.ts";

class CostStub extends ReplayStub {
  readonly costs: readonly (number | null | undefined)[];
  readonly authority: ModelInfo["costAuthority"];
  constructor(id: string, costs: readonly (number | null | undefined)[], authority: ModelInfo["costAuthority"]) {
    super(id); this.costs = costs; this.authority = authority;
  }
  override async getModelInfo(model: string): Promise<ModelInfo> {
    return { ...await super.getModelInfo(model), costAuthority: this.authority };
  }
  override async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2], observed?: ObservedProviderSession): AsyncIterable<NormalizedEvent> {
    const cost = this.costs[this.launches++];
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const base = { runId: registration.runId, hostAt: AT, providerAt: null };
    try {
      yield { ...base, seq: 1, kind: "model.resolved", adapter: this.id, provider: (await this.getModelInfo(request.model)).provider,
        requestedModel: request.model, resolvedModel: request.model, provenance: "stream-authoritative" };
      yield { ...base, seq: 2, kind: "text.delta", text: "{}" };
      yield { ...base, seq: 3, kind: "run.completed", exitCode: 0 };
    } finally {
      // Match the adapter contract: observations arrive when execute is drained.
      if (observed !== undefined) {
        if (cost === undefined) delete observed.costUsd;
        else observed.costUsd = cost;
      }
    }
  }
}

for (const [name, authority, costs, expected] of [
  ["catalog estimates survive both sends", "catalog-estimate", [0.125, 0.25], [0.125, 0.25]],
  ["provider-reported zero stays zero", "provider", [0, 0], [0, 0]],
  ["unpriced route stays unknown", "unavailable", [null, null], [null, null]],
  ["absent optional cost stays unknown", "catalog-estimate", [undefined, undefined], [null, null]],
] satisfies [string, ModelInfo["costAuthority"], (number | null | undefined)[], (number | null)[]][]) {
  test(`B7-12: ${name} in evidence and the correction accumulator`, async t => {
    const received: (number | null)[] = [];
    const totals: (number | null)[] = [];
    const original = UsageAccumulator.prototype.add;
    t.mock.method(UsageAccumulator.prototype, "add", function (this: UsageAccumulator, turn: Pick<AgentTurn, "usage" | "costUsd">) {
      received.push(turn.costUsd);
      original.call(this, turn);
      totals.push(this.snapshot().costUsd);
    });
    const b = box(config => { config.risk.correction_allowance.auto = 0; });
    try {
      const created = await draft(b);
      await prepare(b, created.attemptDir);
      await start(b, created.attemptDir);
      const status = await run(b, created.attemptDir, { ...b.infrastructure,
        adapterFor: (_entry: unknown, id: string) => new CostStub(id, costs, authority) });
      assert.equal(status.lifecycleState, "BLOCKED", "only envelope form fails, after the two accounted sends");
      const agents = (await readAttemptEvidence(created.attemptDir)).filter(row => row.type === "agent");
      assert.equal(agents.length, 2);
      assert.deepEqual(agents.map(row => row.costAuthority), [authority, authority]);
      assert.deepEqual(agents.map(row => row.costUsd), expected, "observed cost is retained in agent evidence");
      assert.deepEqual(received, expected, "AgentTurn forwards the same observed cost to UsageAccumulator");
      const first = expected[0] ?? null;
      assert.deepEqual(totals, first === null ? [null, null] : [first, first + expected[1]!]);
    } finally { b.close(); }
  });
}

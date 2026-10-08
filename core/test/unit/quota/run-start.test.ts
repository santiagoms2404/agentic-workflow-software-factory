import { test } from "node:test";
import { runStartQuota } from "../../fixtures/run-start-quota.ts";

for (const unavailable of ["missing", "timeout", "stale", "unparseable"] as const) {
  test(`run-start quota ${unavailable} is journaled unknown and does not refuse`, async () => {
    await runStartQuota({ id: "TR-14", unavailable, allow: true });
  });
}
test("an unused exhausted configured route is never probed or refused", async () => {
  await runStartQuota({ id: "TR-14", unusedExhausted: true, allow: true });
});
test("a positive window below no configured threshold does not refuse", async () => {
  await runStartQuota({ id: "TR-15", condition: "below-threshold", minutes: 10, allow: true });
});
test("the configured threshold boundary is inclusive", async () => {
  await runStartQuota({ id: "TR-15", condition: "below-threshold", threshold: 30, minutes: 30, allow: true });
});

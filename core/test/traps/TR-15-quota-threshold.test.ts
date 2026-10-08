import { test } from "node:test";
import { runStartQuota } from "../fixtures/run-start-quota.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-15 refusal assertion: a configured threshold refuses before L4", async () => {
  await runStartQuota({ id: "TR-15", condition: "below-threshold", threshold: 30, minutes: 10 });
});
test("TR-15 refusal assertion: the per-adapter threshold overrides the default", async () => {
  await runStartQuota({ id: "TR-15", condition: "below-threshold", threshold: 30, minutes: 10, byAdapter: true });
});

ownMutant({ id: "TR-15", file: import.meta.filename });

import { test } from "node:test";
import { runStartQuota } from "../fixtures/run-start-quota.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-14 refusal assertion: zero allowance refuses without any configured threshold", async () => {
  await runStartQuota({ id: "TR-14", condition: "exhausted" });
});
test("TR-14 refusal assertion: a rejected window refuses", async () => {
  await runStartQuota({ id: "TR-14", condition: "rejected" });
});
test("TR-14 refusal assertion: the review route refuses before the builder reserves", async () => {
  await runStartQuota({ id: "TR-14", secondRoute: true });
});
test("TR-14 refusal assertion: every known scope is checked", async () => {
  await runStartQuota({ id: "TR-14", multipleScopes: true });
});

for (const condition of ["rejected", "exhausted"] as const) {
  for (const unknownBinding of ["unknown-runway", "no-single-window", "missing-reset"] as const) {
    test(`TR-14 refusal assertion: ${condition} with ${unknownBinding} refuses before spend`, async () => {
      await runStartQuota({ id: "TR-14", condition, unknownBinding });
    });
  }
}

ownMutant({ id: "TR-14", file: import.meta.filename });

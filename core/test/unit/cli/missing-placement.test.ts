import { test } from "node:test";
import { placementRefusal } from "../../fixtures/missing-placement.ts";

for (const condition of ["missing", "unreadable", "invalid"] as const) {
  test(`start refuses ${condition} design-context placement before preparing a tree`, async () => {
    await placementRefusal(condition);
  });
}

import { test } from "node:test";
import { placementRefusal } from "../fixtures/missing-placement.ts";
import { ownMutant } from "./_mutate.ts";

for (const condition of ["missing", "unreadable", "invalid"] as const) {
  test(`TR-17 refusal assertion: ${condition} placement`, async () => { await placementRefusal(condition); });
}

ownMutant({ id: "TR-17", file: import.meta.filename });

import assert from "node:assert/strict";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { refusals } from "./k1-preflight.ts";
import { assertRefusedBeforeSpend, box, draft, k1Request, prepare, refusalAssertion, start } from "../traps/_harness.ts";

/** S27's outer request is well shaped and omits the selected ticket's plan path. */
export async function shiftTicketPathRefusal(): Promise<void> {
  const id = "TR-16";
  const label = refusalAssertion(id);
  const b = box();
  try {
    const created = await draft(b, k1Request("run the selected ticket", "core/src/example.ts"), "shift", true);
    await prepare(b, created.attemptDir);
    try { await start(b, created.attemptDir); } catch (error) {
      assert.equal((error as Error).name, "StartPreflightRefused", label);
    }
    const record = (await refusals(created.attemptDir)).at(-1);
    assertRefusedBeforeSpend({ id, expectedRefusal: "awsf.preflight-refused/v1", observedRefusal: record?.schema,
      status: await readAttempt(created.attemptDir), world: b, preparation: true });
    assert.equal(record?.field, "write-boundary", label);
    assert.match(record?.reason ?? "", /ticket T01 DO token specs\/synthetic\.html.*--read/u, label);
  } finally { b.close(); }
}

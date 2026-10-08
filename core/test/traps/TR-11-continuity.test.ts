import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PiCodexAdapter } from "../../src/adapters/pi-codex.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { assertRefusedBeforeSpend, box, draft, refusalAssertion } from "./_harness.ts";
import { ownMutant } from "./_mutate.ts";

// G09's fail-open route must prove continuity from a synthetic host store,
// never from the owner's session directory or a live provider process.
test("TR-11 refusal assertion", async () => {
  const world = box();
  const label = refusalAssertion("TR-11");
  try {
    const created = await draft(world);
    const storeDir = join(world.root, "synthetic-session-store");
    mkdirSync(storeDir);
    let failure: unknown;
    try {
      new PiCodexAdapter().assertResumable({ providerSessionId: "synthetic-unknown-session", storeDir }, { cwd: world.repository });
    } catch (error) { failure = error; }
    assertRefusedBeforeSpend({ id: "TR-11", expectedRefusal: "E_BACKEND_FAILURE",
      observedRefusal: failure instanceof Error && "code" in failure ? String(failure.code) : null,
      status: await readAttempt(created.attemptDir), world, preparation: true });
    assert.ok(failure instanceof Error, label);
    assert.match(failure.message, /no session in the host-owned store/u, `${label}: missing session`);
  } finally { world.close(); }
});

ownMutant({ id: "TR-11", file: import.meta.filename });

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ReplayRecord } from "../../../src/contracts/proving-ground.ts";
import { bindProveRecipe, PROVING_GROUND_DIR } from "../../../src/workflow/prove/bind.ts";
import { ProveItemInvalid } from "../../../src/workflow/prove/compile.ts";

const ARM = "claude/anthropic/claude:opus@high";
const REQUEST = "Report the probe's second line.";
const CONFIG = { prompts: { builder: "builder prompt", reviewer: "reviewer prompt" }, gates: ["test"] };

// B6-27: the frozen item was parsed with a bare JSON.parse outside any try, so a
// truncated or hand-edited item escaped as a raw SyntaxError with no item id or
// path. The corpus reader wraps the same parse as ProveItemInvalid.
test("B6-27: a malformed proving-ground item refuses as ProveItemInvalid, naming its file", async () => {
  const repository = mkdtempSync(join(tmpdir(), "awsf-prove-bind-b6-27-"));
  mkdirSync(join(repository, PROVING_GROUND_DIR), { recursive: true });
  writeFileSync(join(repository, PROVING_GROUND_DIR, "probe-01.json"), "{\"schema\": \"awsf.proving-ground-item/v1\", \"id\": ");
  const replay: ReplayRecord = {
    itemId: "probe-01", itemDigest: "a".repeat(64), arm: ARM, repetition: 1, order: 1, baseSha: "b".repeat(40),
  };
  await assert.rejects(
    bindProveRecipe({ repository, request: REQUEST, replay }, CONFIG),
    (error: unknown) => {
      assert.ok(error instanceof ProveItemInvalid, `expected ProveItemInvalid, got ${String(error)}`);
      assert.match(error.message, /core\/src\/metrics\/proving-ground\/probe-01\.json/);
      return true;
    },
  );
});

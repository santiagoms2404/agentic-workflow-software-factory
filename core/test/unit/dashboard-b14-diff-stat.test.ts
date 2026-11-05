import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./meta/_walk.ts";

test("B14-37: owner gate card renders structured counts only for its candidate", () => {
  const source = readFileSync(join(repoRoot(), "dashboard/src/components/OwnerGateCard.vue"), "utf8");
  assert.match(source, /props\.session\.candidateDiffStat/u);
  assert.match(source, /stat\.baseSha !== props\.session\.baseSha/u);
  assert.match(source, /stat\.candidateSha !== props\.session\.candidateSha/u);
  assert.match(source, /stat\.insertions/u);
  assert.match(source, /stat\.deletions/u);
  assert.doesNotMatch(source, /JSON\.stringify|\.match\(/u);
});

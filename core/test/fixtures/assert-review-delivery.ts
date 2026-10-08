import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { ModelRequest } from "../../src/adapters/interface.ts";
import type { ReviewDiffDelivery } from "../../src/contracts/review-context.ts";

export function assertReviewDelivery(request: ModelRequest) {
  const indexPath = /^Index: (.+)$/mu.exec(request.prompt)?.[1];
  assert.ok(indexPath, "mandatory review names its delivered index before GO");
  const directory = dirname(indexPath);
  assert.ok(request.readOnlyRoots?.includes(directory), "the same directory is a readonly input root");
  assert.equal(request.readOnlyRoots?.includes(request.cwd), false);
  assert.ok(request.prompt.includes("no command may be run"));
  const indexText = readFileSync(indexPath, "utf8");
  const index = JSON.parse(indexText) as { token: string; diffSha256: string; files: ReviewDiffDelivery["files"] };
  assert.equal(request.prompt.includes(index.token), false);
  const full = Buffer.concat(index.files.map(file => {
    const bytes = readFileSync(join(directory, file.file));
    assert.equal(bytes.length, file.bytes);
    return bytes;
  }));
  assert.equal(createHash("sha256").update(full).digest("hex"), index.diffSha256);
  assert.ok(request.prompt.includes(index.diffSha256));
  return { index, directory, full };
}

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import type { CandidateSeed } from "../../../src/contracts/candidate-seed.ts";
import { CandidateSeedRejected, validateSeedStartup } from "../../../src/workflow/candidate-seed.ts";
import { validConfig } from "../config/fixture.ts";

// B6-14: validateSeedStartup joined the seed's source task id into a path and
// read its journal before any containment check, unlike assertIntegrationSource,
// which refuses a source that is not a sealed attempt beside the target.
test("B6-14: a seed source whose task id escapes the tasks root is refused before anything is read", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-seed-b6-14-"));
  const attemptDir = join(root, "tasks", "target", "1");
  const seed = {
    source: { project: "fixture", taskId: "../../escape", attempt: 1, sessionId: "source-session", revision: 1, journalDigest: "0".repeat(64) },
    seedCandidateSha: "a".repeat(40),
    configDigest: "b".repeat(64),
  } as unknown as CandidateSeed;
  const status = { seed: null, repository: root } as unknown as AttemptStatus;

  await assert.rejects(
    validateSeedStartup(seed, status, validConfig(), join(root, "awsf.config.yaml"), attemptDir),
    (error: unknown) => error instanceof CandidateSeedRejected && /not a sealed attempt beside the target/.test(error.message),
  );
});

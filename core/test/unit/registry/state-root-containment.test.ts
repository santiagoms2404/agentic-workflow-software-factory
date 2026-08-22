import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { doctorCommand } from "../../../src/cli/commands/doctor.ts";
import { gcCommand, rebuildCommand } from "../../../src/cli/commands/operator.ts";
import { discoverAttempts } from "../../../src/observability/rebuild.ts";
import { repoRoot, walkFiles } from "../meta/_walk.ts";

test("discoverAttempts skips placement.yaml beside a project's tasks directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-placement-discovery-"));
  try {
    const project = join(root, "projects", "acme");
    const attempt = join(project, "tasks", "T07", "1");
    mkdirSync(attempt, { recursive: true });
    writeFileSync(join(attempt, "journal.jsonl"), "");
    writeFileSync(join(project, "placement.yaml"), "project: acme\n");

    assert.deepEqual(await discoverAttempts(root), [attempt]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("operator commands retain one shared state root and registry does not resolve one", () => {
  assert.equal(doctorCommand.length, 1);
  assert.equal(gcCommand.length, 1);
  assert.equal(rebuildCommand.length, 1);

  const commands = readFileSync(join(repoRoot(), "core/src/cli/commands/doctor.ts"), "utf8") +
    readFileSync(join(repoRoot(), "core/src/cli/commands/operator.ts"), "utf8");
  for (const command of ["doctorCommand", "gcCommand", "rebuildCommand"]) {
    assert.match(commands, new RegExp(`function ${command}\\(stateRoot: string\\)`));
  }

  for (const file of walkFiles(join(repoRoot(), "core/src/registry"))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\bresolveStateRoot\b/u, file);
  }
});

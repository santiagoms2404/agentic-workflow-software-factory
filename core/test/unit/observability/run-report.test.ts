import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import { locateRunReport, runReportLocation } from "../../../src/observability/run-report.ts";

test("run reports live beside sealed attempts and resolve through a task-relative path", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-run-report-"));
  try {
    const attemptDir = join(root, "projects", "project", "tasks", "task", "1");
    await mkdir(attemptDir, { recursive: true });
    const location = runReportLocation(attemptDir, 1, "reports/owner-readable.md");
    assert.equal(location.taskRelativePath, "run-reports/attempt-1-owner-readable.md");
    assert.match(relative(attemptDir, location.absolutePath), /^\.\./u);
    await mkdir(join(root, "projects", "project", "tasks", "task", "run-reports"), { recursive: true });
    await writeFile(location.absolutePath, "# Report\n");
    assert.deepEqual(await locateRunReport(attemptDir), location);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run report storage rejects an invalid attempt or logical destination", () => {
  assert.throws(() => runReportLocation("/tmp/task/1", 0, "reports/report.md"), /attempt number/);
  assert.throws(() => runReportLocation("/tmp/task/1", 1, "../report.md"), /logical run-report path/);
});

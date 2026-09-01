import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import {
  RUN_REPORT_REVISION_STAMP,
  locateRunReport,
  runReportLocation,
  runReportRevision,
} from "../../../src/observability/run-report.ts";

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

test("the newest report wins, not the alphabetically first", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-run-report-newest-"));
  try {
    const attemptDir = join(root, "projects", "project", "tasks", "task", "1");
    const reports = join(root, "projects", "project", "tasks", "task", "run-reports");
    await mkdir(attemptDir, { recursive: true });
    await mkdir(reports, { recursive: true });

    // `a-...` sorts first and is the older render; `z-...` is current. The old
    // locator returned the first name and would keep naming the superseded one
    // forever, with `awsf status` calling it the current projection.
    await writeFile(join(reports, "attempt-1-a-first-alphabetically.md"), `# Report\n\n${RUN_REPORT_REVISION_STAMP} 3\n`);
    await writeFile(join(reports, "attempt-1-z-last-alphabetically.md"), `# Report\n\n${RUN_REPORT_REVISION_STAMP} 9\n`);

    const located = await locateRunReport(attemptDir);
    assert.equal(located?.taskRelativePath, "run-reports/attempt-1-z-last-alphabetically.md");
    assert.equal(await runReportRevision(located!.absolutePath), 9);

    // A report for another attempt is never confused for this one.
    await writeFile(join(reports, "attempt-2-later-attempt.md"), `# Report\n\n${RUN_REPORT_REVISION_STAMP} 99\n`);
    assert.equal((await locateRunReport(attemptDir))?.taskRelativePath, "run-reports/attempt-1-z-last-alphabetically.md");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unstamped or missing report reads as no revision rather than throwing", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-run-report-stamp-"));
  try {
    const file = join(root, "unstamped.md");
    await writeFile(file, "# Report\n\nno stamp here\n");
    assert.equal(await runReportRevision(file), null);
    assert.equal(await runReportRevision(join(root, "absent.md")), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

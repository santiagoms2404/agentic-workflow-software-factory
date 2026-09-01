import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import {
  RUN_REPORT_REVISION_STAMP,
  demoteHeadings,
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

test("an embedded documenter draft never competes with the host's own outline", () => {
  // Verbatim shape from the real simple-sdlc report: a nested H1, the request
  // and plan stated a second time in a second voice, and a "Pending" heading
  // sitting directly above the sections it said were pending.
  const draft = [
    "# Run report — simple-sdlc host-request phase assertion",
    "",
    "## Request",
    "",
    "The owner asked for one bounded source.",
    "",
    "```bash",
    "# awsf status TASK --evidence   <- a comment, not a heading",
    "```",
    "",
    "###### already at the floor",
  ].join("\n");

  const embedded = demoteHeadings(draft);
  assert.match(embedded, /^### Run report — simple-sdlc host-request phase assertion$/mu);
  assert.match(embedded, /^#### Request$/mu);
  // The shell comment inside the fence is left exactly as written, so H1/H2
  // are counted outside fences only.
  assert.match(embedded, /^# awsf status TASK --evidence {3}<- a comment, not a heading$/mu);
  const outsideFences = embedded.split(/^```.*$/mu).filter((_, index) => index % 2 === 0).join("\n");
  assert.doesNotMatch(outsideFences, /^# /mu, "no H1 survives inside the host's document");
  assert.doesNotMatch(outsideFences, /^## /mu, "no H2 competes with the host's own sections");
  assert.match(embedded, /^###### already at the floor$/mu, "H6 is the floor, not H8");
});

// The Jev row in `awsf doctor` (W19 task 3): the switch, whether the key is
// set (never its value or length), the requested model and the fence, with no
// network call.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withJevRow, type DoctorReport } from "../../../src/cli/commands/doctor.ts";
import { JEV_TRANSPORT_FILE, jevDoctorRow, jevFenceStatus } from "../../../src/decision/jev-doctor.ts";
import { JEV_DEFAULT_MODEL, JEV_KEY_ENV } from "../../../src/decision/jev-transport.ts";
import { repoRoot } from "../meta/_walk.ts";

// Not a credential: a distinctive placeholder, so a leak of it or its length would be visible.
const KEY = "placeholder-value-that-must-never-print-0123456789";
const CATALOG = [
  "version: awsf.project/v1",
  "project:",
  "  slug: sample",
  "repositories:",
  "  plans:",
  "    role: plan",
  "    default_branch: main",
  "plans:",
  "  root: specs",
  "  format: awsf-plan-html/v1",
].join("\n");

function scratch(label: string): { root: string; close: () => void; write: (file: string, text: string) => string } {
  const root = mkdtempSync(join(tmpdir(), `awsf-jev-doctor-${label}-`));
  return {
    root,
    close: () => rmSync(root, { recursive: true, force: true }),
    write: (file, text) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
      return join(root, file);
    },
  };
}

test("the key is reported as set or unset and nothing else: not its value, its length or a prefix", async (t) => {
  const box = scratch("key");
  t.mock.method(globalThis, "fetch", () => { throw new Error("doctor must make no network call"); });
  try {
    const catalogPath = join(box.root, "absent.yaml");
    // A one-file source tree, so no file count in the row can be mistaken for the key's length.
    box.write(`src/${JEV_TRANSPORT_FILE}`, "export {};");
    const sourceRoot = join(box.root, "src");
    const set = await jevDoctorRow({ catalogPath, env: { [JEV_KEY_ENV]: KEY }, sourceRoot });
    assert.match(set.line, new RegExp(`${JEV_KEY_ENV} set;`));
    assert.equal(set.line.includes(KEY.slice(0, 4)), false);
    assert.equal(set.line.includes(String(KEY.length)), false);
    assert.equal(set.finding, null);

    for (const env of [{}, { [JEV_KEY_ENV]: "" }, { [JEV_KEY_ENV]: "   " }]) {
      const unset = await jevDoctorRow({ catalogPath, env, sourceRoot });
      assert.match(unset.line, new RegExp(`${JEV_KEY_ENV} unset;`));
      assert.equal(unset.finding, null, "an unset key is Jev's documented fallback, not a finding");
    }
    assert.equal((globalThis.fetch as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);
  } finally { box.close(); }
});

test("the row names the switch and where it came from, and the requested model", async () => {
  const box = scratch("switch");
  try {
    const row = async (text: string | null) =>
      jevDoctorRow({ catalogPath: text === null ? join(box.root, "none.yaml") : box.write("awsf.project.yaml", text), env: {} });
    assert.match((await row(null)).line, /^jev: switch on \(default, no catalog\); /);
    assert.match((await row(CATALOG)).line, /^jev: switch on \(default\); /);
    assert.match((await row(`${CATALOG}\ndecision:\n  jev: off`)).line, /^jev: switch off \(catalog\); /);
    assert.match((await row(`${CATALOG}\ndecision:\n  jev: on`)).line, /^jev: switch on \(catalog\); /);
    assert.ok((await row(CATALOG)).line.includes(`requested model ${JEV_DEFAULT_MODEL};`));
    assert.ok((await row(CATALOG)).line.endsWith("no network call made"));

    const invalid = await row(`${CATALOG}\ndecision:\n  jev: maybe`);
    assert.match(invalid.line, /^jev: switch unknown: catalog invalid/);
    assert.match(invalid.finding ?? "", /^jev switch unknown/);
  } finally { box.close(); }
});

test("the fence is intact over this checkout's core/src", async () => {
  const fence = await jevFenceStatus(join(repoRoot(), "core", "src"));
  assert.equal(fence.state, "intact", JSON.stringify(fence));
  // The default is the installed source this module was loaded from.
  assert.equal((await jevFenceStatus()).state, "intact");
  const row = await jevDoctorRow({ catalogPath: join(repoRoot(), "awsf.project.yaml"), env: {} });
  assert.match(row.line, new RegExp(`fence intact \\(${JEV_TRANSPORT_FILE} is the only caller across \\d+ files\\)`));
});

test("a planted fetch or endpoint breaches the fence and is a finding; a tree without the transport is unchecked", async () => {
  const box = scratch("fence");
  try {
    box.write(`src/${JEV_TRANSPORT_FILE}`, `await fetch("https://openrouter.ai/api/alpha/decisions");`);
    box.write("src/workflow/fine.ts", "export const ok = prefetch;");
    assert.deepEqual(await jevFenceStatus(join(box.root, "src")), { state: "intact", files: 2 });

    box.write("src/workflow/sneaky.ts", "export const send = globalThis.fetch;");
    box.write("src/cli/url.ts", `export const url = "https://openrouter.ai/api/alpha/decisions";`);
    assert.deepEqual(await jevFenceStatus(join(box.root, "src")), { state: "breached", offenders: ["cli/url.ts", "workflow/sneaky.ts"] });
    const row = await jevDoctorRow({ catalogPath: join(box.root, "none.yaml"), env: {}, sourceRoot: join(box.root, "src") });
    assert.match(row.line, /fence breached \(cli\/url\.ts, workflow\/sneaky\.ts\)/);
    assert.match(row.finding ?? "", /^jev fence breached: cli\/url\.ts, workflow\/sneaky\.ts/);

    box.write("empty/other.ts", "export {};");
    assert.equal((await jevFenceStatus(join(box.root, "empty"))).state, "unchecked");
    assert.equal((await jevFenceStatus(join(box.root, "missing"))).state, "unchecked");
  } finally { box.close(); }
});

test("withJevRow puts the row before the summary, and a Jev finding makes the report unhealthy", () => {
  const healthy: DoctorReport = {
    healthy: true,
    lines: ["matrix: 1 legal edges across 2 states", "attempts: 0; database: not built", "healthy: no controller orphan"],
  };
  const merged = withJevRow(healthy, { line: "jev: row", finding: null });
  assert.deepEqual(merged, { healthy: true, lines: ["jev: row", ...healthy.lines] });

  const broken = withJevRow(healthy, { line: "jev: row", finding: "jev fence breached: x.ts" });
  assert.equal(broken.healthy, false);
  assert.deepEqual(broken.lines, ["jev: row", healthy.lines[0], healthy.lines[1], "finding: jev fence breached: x.ts"]);

  const already: DoctorReport = { healthy: false, lines: ["matrix: m", "attempts: a", "finding: stale lock: t"] };
  assert.deepEqual(withJevRow(already, { line: "jev: row", finding: null }), { healthy: false, lines: ["jev: row", ...already.lines] });
});

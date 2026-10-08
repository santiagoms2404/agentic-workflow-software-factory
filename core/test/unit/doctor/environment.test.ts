import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { main } from "../../../src/cli/main.ts";
import { loadConfig } from "../../../src/config/load.ts";
import { DoctorReadoutSchema } from "../../../src/contracts/doctor-readout.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS } from "../../../src/contracts/registry.ts";
import { executablesRow } from "../../../src/doctor/executables.ts";
import { gatherDoctorRows } from "../../../src/doctor/gather.ts";
import { providersRow } from "../../../src/doctor/providers.ts";
import { quotaDiagnostics, quotaRow } from "../../../src/doctor/quota.ts";
import { buildDoctorReport } from "../../../src/doctor/report.ts";
import { storageRow } from "../../../src/doctor/storage.ts";
import { parseQuotaReadout } from "../../../src/quota/parse.ts";
import type { QuotaProbeResult } from "../../../src/quota/probe.ts";
import { mapConfiguredQuotaRoutes } from "../../../src/quota/routes.ts";
import { unconfiguredDoctorEnvironment } from "../../fixtures/doctor-environment.ts";

const now = "2026-08-24T20:26:39.429Z";
const configText = readFileSync(new URL("../../../../awsf.config.yaml", import.meta.url), "utf8");
const routes = mapConfiguredQuotaRoutes(loadConfig(configText));
function fixture(name: string) { return readFileSync(new URL(`../../fixtures/quota-axi/${name}.json`, import.meta.url), "utf8"); }
function result(name: string): QuotaProbeResult {
  const parsed = parseQuotaReadout(fixture(name), now);
  return { availability: "known", failure: null, readout: parsed.readout, parsed, resolvedVersion: "0.1.29" };
}
function snapshot(root: string): unknown[] {
  const out: unknown[] = [];
  function visit(path: string) {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      const info = statSync(full);
      out.push([relative(root, full), info.mode, info.mtimeMs, info.isDirectory() ? null : readFileSync(full).toString("hex")]);
      if (info.isDirectory()) visit(full);
    }
  }
  visit(root);
  return out;
}

const existing = { healthy: true, lines: ["matrix: 27 legal edges across 11 states", "attempts: 0; database: not built", "healthy: no controller orphan"] };
const jev = { line: "jev: unchanged", finding: null };

test("storage uses K1's all-0777 signature, reports roots, and warns when unreadable", () => {
  const facts = { commonDirectory: "/synthetic/git", worktreeRoot: "/synthetic/tree", stateRoot: "/synthetic/state",
    gitEntries: ["HEAD", "config", "tree"].map(path => ({ path, mode: 0o777 })), stateEntry: { path: "state", mode: 0o700 } };
  assert.equal(storageRow(facts).status, "finding");
  assert.match(storageRow(facts).detail.join("\n"), /DrvFs/);
  assert.equal(storageRow({ ...facts, gitEntries: [{ path: "HEAD", mode: 0o644 }] }).status, "ok");
  assert.equal(storageRow({ ...facts, gitEntries: [{ path: "HEAD", mode: null }] }).status, "warn");
  assert.equal(storageRow({ ...facts, gitEntries: [{ path: "HEAD", mode: 0o644 }], stateEntry: { path: "state", mode: 0o777 } }).status, "finding");
});

test("unresolvable configured CLI is a finding; resolved executables are descriptive", () => {
  assert.equal(executablesRow([{ name: "adapter custom", executable: "missing-cli", resolved: null }]).status, "finding");
  assert.equal(executablesRow([{ name: "git", executable: "git", resolved: "/synthetic/git" }]).status, "ok");
});

test("login is measured from status only; pi login is never inferred from Codex", () => {
  const healthy = providersRow(routes, result("nominal"));
  assert.ok(healthy.detail.some(line => line.includes("login=logged in")));
  assert.ok(healthy.detail.some(line => line.includes("login=not measured (quota-axi reads Codex auth, not pi auth)")));
  assert.equal(providersRow(routes, result("derived-state-unauthenticated")).status, "finding");
  const unreadable = result("nominal");
  const unknown = providersRow(routes, { ...unreadable, readout: { providers: unreadable.readout.providers.map(provider => ({ ...provider, stateStatus: "new-unknown-status" })) } });
  assert.equal(unknown.status, "warn");
  assert.ok(unknown.detail.every(line => line.includes("login=not measured")));
});

test("exhausted quota and configured low threshold warn; unavailable probe is a finding", () => {
  const exhausted = quotaRow(routes, result("derived-exhausted-now"), undefined, 5, quotaDiagnostics(fixture("derived-exhausted-now")));
  assert.equal(exhausted.status, "warn");
  assert.match(exhausted.detail.join("\n"), /window=five_hour.*remaining=0%/);
  assert.match(exhausted.detail.join("\n"), /usable runway seconds=0/);
  assert.match(exhausted.detail.join("\n"), /exhausted/);
  const below = quotaRow(routes, result("nominal"), { default: { minutes: 10000, probe_timeout_ms: 8000 } }, 5);
  assert.equal(below.status, "warn");
  const unavailable: QuotaProbeResult = { ...result("nominal"), availability: "unavailable", failure: { reasonCode: "executable-not-found", executable: "quota-axi" } };
  assert.equal(quotaRow(routes, unavailable, undefined, 5).status, "finding");
  assert.deepEqual(quotaDiagnostics("broken JSON"), []);
});

test("gatherer uses one sandboxed quota probe, renders every row, writes nothing, and exposes latency", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-doctor-env-"));
  try {
    writeFileSync(join(root, "awsf.config.yaml"), configText);
    const gitRoot = join(root, "git-common");
    mkdirSync(gitRoot);
    writeFileSync(join(gitRoot, "HEAD"), "synthetic head");
    writeFileSync(join(gitRoot, "config"), "synthetic config");
    const stateRoot = join(root, "state");
    const before = snapshot(root);
    const invocations: string[][] = [];
    const rows = await gatherDoctorRows({ cwd: root, stateRoot, env: { PATH: "/synthetic/bin" }, now,
      resolveExecutable: (executable, env) => { assert.equal(env.PATH, "/synthetic/bin"); return `/synthetic/bin/${executable}`; },
      runCommand: (executable, argv, options) => {
        invocations.push([executable, ...argv]);
        assert.ok(options.timeoutMs > 0);
        if (executable.endsWith("/git")) return { status: 0, error: null, stderr: "", stdout: argv.includes("--git-common-dir") ? gitRoot : root };
        assert.ok(executable.endsWith("/bwrap"));
        assert.deepEqual(argv.slice(0, 10), ["--die-with-parent", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--setenv", "QUOTA_AXI_CODEX_BINARY"]);
        assert.equal(argv[10], "/dev/null", "the provider RPC fallback cannot execute");
        assert.ok(argv.includes("/synthetic/bin/quota-axi"));
        return { status: 0, error: null, stderr: "", stdout: argv.includes("--version") ? "0.1.29" : fixture("derived-exhausted-now") };
      },
    });
    assert.equal(invocations.length, 4, "two read-only git queries, quota version and one JSON probe");
    assert.equal(rows.quota.status, "warn");
    assert.match(rows.quota.detail[0]!, /latency=\d+ ms/);
    assert.deepEqual(snapshot(root), before, "including absence of state root and quota retention files");
    const model = buildDoctorReport(existing, jev, rows);
    assert.equal(model.healthy, true, "low quota does not change exit");
    assert.equal(Value.Check(DoctorReadoutSchema, JSON.parse(JSON.stringify(model))), true);
    assert.equal(RECORD_SCHEMAS["awsf.doctor/v1"], DoctorReadoutSchema);
    assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, "awsf.doctor/v1"), false);
    for (const name of Object.keys(rows)) {
      assert.ok(model.lines.some(line => line.startsWith(`${name}: `)));
      assert.ok(model.lines.findIndex(line => line.startsWith(`${name}: `)) < model.lines.indexOf(existing.lines[0]!));
    }
    assert.equal(buildDoctorReport(existing, jev, { ...rows, executables: { status: "finding", detail: ["missing CLI"] } }).healthy, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("failed and malformed quota bytes are never retained, echoed or written", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-doctor-unavailable-"));
  try {
    writeFileSync(join(root, "awsf.config.yaml"), configText);
    const before = snapshot(root);
    for (const failure of ["nonzero", "malformed", "timeout", "missing"]) {
      const rows = await gatherDoctorRows({ cwd: root, stateRoot: join(root, "state"), env: { PATH: "/synthetic" }, now,
        resolveExecutable: executable => { if (failure === "missing" && executable === "quota-axi") throw new Error("missing"); return `/synthetic/${executable}`; },
        runCommand: (executable, argv) => {
          if (executable.endsWith("/git")) return { status: 1, error: null, stderr: "", stdout: "" };
          if (failure === "timeout") return { status: null, error: "ETIMEDOUT", stdout: "private bytes must not escape", stderr: "" };
          return { status: failure === "nonzero" ? 1 : 0, error: null, stderr: "private bytes must not escape", stdout: argv.includes("--version") ? "0.1.29" : "private bytes must not escape" };
        },
      });
      assert.equal(rows.quota.status, "finding");
      assert.equal(JSON.stringify(rows).includes("private bytes must not escape"), false);
      assert.deepEqual(snapshot(root), before);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("doctor main emits named text and JSON rows, findings exit 1, and leaves all bytes untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-doctor-main-"));
  try {
    const env = unconfiguredDoctorEnvironment(root);
    const before = snapshot(root);
    for (const json of [false, true]) {
      const lines: string[] = [];
      const code = await main({ argv: ["doctor", "--state-root", join(root, "state"), ...(json ? ["--json"] : [])], cwd: root, env, writeOut: line => lines.push(line) });
      assert.equal(code, 0);
      if (json) {
        assert.equal(lines.length, 1);
        const model = JSON.parse(lines[0]!);
        assert.equal(Value.Check(DoctorReadoutSchema, model), true);
        assert.deepEqual(Object.keys(model.rows), ["existing", "jev", "storage", "executables", "providers", "quota", "coverage"]);
      } else for (const name of ["jev", "storage", "executables", "providers", "quota", "coverage"]) assert.ok(lines.some(line => line.startsWith(`${name}: `)));
      assert.deepEqual(snapshot(root), before);
    }
    const lines: string[] = [];
    assert.equal(await main({ argv: ["doctor", "--json", "--state-root", join(root, "state")], cwd: root, env: { PATH: "" }, writeOut: line => lines.push(line) }), 1);
    assert.equal(JSON.parse(lines[0]!).rows.executables.status, "finding");
    assert.deepEqual(snapshot(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("coverage reduces large synthetic journals and reports unlinked stops without running traps", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-doctor-large-"));
  try {
    const stateRoot = join(root, "state");
    const projectRoot = join(stateRoot, "projects", "synthetic");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "placement.yaml"), `version: awsf.placement/v1\nproject: synthetic\nrepositories:\n  main:\n    path: ${root}\n`);
    const attemptRoot = join(projectRoot, "tasks", "synthetic-stop", "1");
    mkdirSync(attemptRoot, { recursive: true });
    const status = { project: "synthetic", taskId: "synthetic-stop", attempt: 1, lifecycleState: "BLOCKED", workflow: "build", baseSha: "a".repeat(40), candidateSha: null };
    const journal = join(attemptRoot, "journal.jsonl");
    // Synthetic non-transition records, one MiB each; none copied from run data.
    for (let seq = 1; seq <= 8; seq++) appendFileSync(journal, `${JSON.stringify({ source_seq: seq, recorded_at: "2026-10-08T12:00:00.000Z", event: { kind: "attempt.updated", next: status, detail: "x".repeat(1024 * 1024) } })}\n`);
    appendFileSync(journal, `${JSON.stringify({ source_seq: 9, recorded_at: "2026-10-08T12:00:00.000Z", event: { kind: "attempt.transitioned", next: status } })}\n`);
    const before = snapshot(root);
    const rows = await gatherDoctorRows({ cwd: root, stateRoot, env: { PATH: "" } });
    assert.equal(rows.coverage.status, "finding");
    assert.match(rows.coverage.detail.join("\n"), /unlinked stops=1; missing traps=0/);
    assert.deepEqual(snapshot(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../../src/cli/main.ts";
import { metricsExportCommand, type MetricsExportHeader } from "../../src/cli/commands/metrics-export.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { RATE_CARD } from "../../../dashboard/shared/rate-card.ts";
import { AT } from "./_metrics-journal.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "awsf-export-"));
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot);
  openDatabase(join(stateRoot, "awsf.db")).close();
  return { root, stateRoot, extractedAt: AT };
}

test("empty export has a header, exact empty-row digest and unique private files", () => {
  const f = fixture();
  try {
    const first = metricsExportCommand(f);
    const second = metricsExportCommand(f);
    assert.notEqual(first[0], second[0]);
    const path = first[0]!.slice("Export: ".length);
    assert.ok(path.startsWith(join(f.stateRoot, "exports/route-metrics/")));
    const header = JSON.parse(readFileSync(path, "utf8")) as MetricsExportHeader;
    assert.deepEqual(header, { schema: "awsf.route-metrics/v1", extractedAt: AT, checkedAt: RATE_CARD.checkedAt,
      rowCount: 0, rowsSha256: createHash("sha256").update("").digest("hex") });
    assert.equal(first[1], `SHA-256 (rows): ${header.rowsSha256}`);
    assert.ok(readFileSync(path, "utf8").endsWith("\n"));
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("outside-root, traversal, misplaced and forbidden names are refused before export directories are created", () => {
  const f = fixture();
  try {
    for (const output of [join(f.root, "outside.jsonl"), "../../../outside.jsonl", "../../inside-state.jsonl",
      "Manifest.jsonl", "route-RECEIPT.jsonl", "nested/manifestation.jsonl", "..", ""]) {
      assert.throws(() => metricsExportCommand({ ...f, output }));
    }
    assert.equal(existsSync(join(f.stateRoot, "exports")), false);
    assert.equal(existsSync(join(f.root, "outside.jsonl")), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("symlink parents, dangling links and existing destinations (including hard links) cannot redirect or overwrite an export", () => {
  const f = fixture();
  try {
    const directory = join(f.stateRoot, "exports/route-metrics");
    mkdirSync(directory, { recursive: true });
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(directory, "escape"));
    symlinkSync(join(f.root, "absent"), join(directory, "dangling"));
    for (const output of ["escape/rows.jsonl", "dangling/rows.jsonl"]) {
      assert.throws(() => metricsExportCommand({ ...f, output }), /symlink/);
    }
    const original = join(outside, "original.jsonl");
    writeFileSync(original, "keep");
    symlinkSync(original, join(directory, "symlink.jsonl"));
    linkSync(original, join(directory, "hardlink.jsonl"));
    writeFileSync(join(directory, "existing.jsonl"), "keep");
    for (const output of ["symlink.jsonl", "hardlink.jsonl", "existing.jsonl"]) {
      assert.throws(() => metricsExportCommand({ ...f, output }), /EEXIST/);
    }
    assert.equal(readFileSync(original, "utf8"), "keep");
    assert.deepEqual(readdirSync(outside), ["original.jsonl"]);
    rmSync(join(f.stateRoot, "exports"), { recursive: true });
    symlinkSync(outside, join(f.stateRoot, "exports"));
    assert.throws(() => metricsExportCommand(f), /symlink/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a state root inside a checkout or linked worktree is refused, even through an alias", () => {
  for (const gitFile of [false, true]) {
    const f = fixture();
    try {
      if (gitFile) writeFileSync(join(f.root, ".git"), "gitdir: elsewhere");
      else mkdirSync(join(f.root, ".git"));
      assert.throws(() => metricsExportCommand(f), /repository/);
      const alias = join(f.root, "alias");
      symlinkSync(f.stateRoot, alias);
      assert.throws(() => metricsExportCommand({ ...f, stateRoot: alias }), /repository/);
      assert.equal(existsSync(join(f.stateRoot, "exports")), false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test("CLI export accepts only export flags and reports its path and digest", async () => {
  const f = fixture();
  try {
    const out: string[] = [], err: string[] = [];
    const invoke = (argv: string[]) => main({ cwd: f.root, argv: ["metrics", "export", ...argv, "--state-root", f.stateRoot],
      writeOut: (line) => out.push(line), writeError: (line) => err.push(line) });
    for (const args of [["extra"], ["--json"], ["--advise"], ["--source", "production"], ["--role", "builder"],
      ["--task-class", "unclassified"], ["--milestone", "M1"], ["--output", join(f.root, "outside.jsonl")]]) {
      assert.equal(await invoke(args), 1, args.join(" "));
    }
    assert.equal(existsSync(join(f.stateRoot, "exports")), false);
    assert.equal(await invoke(["--output", "named.jsonl"]), 0, err.join("\n"));
    assert.deepEqual(out, [`Export: ${join(f.stateRoot, "exports/route-metrics/named.jsonl")}`,
      `SHA-256 (rows): ${createHash("sha256").update("").digest("hex")}`]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

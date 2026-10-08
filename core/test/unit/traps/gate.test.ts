import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { loadConfig } from "../../../src/config/load.ts";
import { KNOWN_GATE_IDS } from "../../../src/config/schema.ts";
import { gatesConfigDigest } from "../../../src/contracts/command-ledger.ts";
import { evaluateSuite } from "../../../src/preflight/fields.ts";
import { repoRoot } from "../meta/_walk.ts";

const ROOT = repoRoot();
const SHIPPED = readFileSync(join(ROOT, "awsf.config.yaml"), "utf8");
const TRAP_GATE = { argv: ["node", "--experimental-strip-types", "--test", "core/test/traps/**/*.test.ts"], timeout_seconds: 300 };

// No package or owner configuration edit is needed to prove the code half:
// round-trip an in-memory shipped config with the additional gate through
// the actual loader, then require its measured row just like every other gate.
test("the loader accepts traps and K1 binds a passing row for every configured gate including traps", () => {
  const candidate = loadConfig(SHIPPED);
  candidate.gates.traps = TRAP_GATE;
  const config = loadConfig(stringify(candidate));
  assert.ok(KNOWN_GATE_IDS.includes("traps"));
  assert.deepEqual(config.gates.traps, TRAP_GATE);
  const baseSha = "a".repeat(40);
  const digest = gatesConfigDigest(config.gates);
  const rows = Object.keys(config.gates).map(gateId => ({ gateId, sha: baseSha, gatesConfigDigest: digest, passed: true, exitCode: 0 }));
  const facts = { baseSha, configuredGateIds: Object.keys(config.gates), gatesConfigDigest: digest,
    suite: { source: "preflight-run" as const, rows }, unavailable: null };
  assert.deepEqual(evaluateSuite(facts), { passed: true });
  for (const gateId of Object.keys(config.gates)) {
    const missing = evaluateSuite({ ...facts, suite: { ...facts.suite, rows: rows.filter(row => row.gateId !== gateId) } });
    assert.ok(!missing.passed);
    assert.ok(missing.reason.includes(`gate ${gateId} has no row`));
    const red = evaluateSuite({ ...facts, suite: { ...facts.suite, rows: rows.map(row => row.gateId === gateId
      ? { ...row, passed: false, exitCode: 1 } : row) } });
    assert.ok(!red.passed);
    assert.ok(red.reason.includes(`gate ${gateId} failed`));
  }
});

test("every config that strips shipped journeys also strips traps without depending on G02-L's timeout", () => {
  const paths = [
    "core/test/journeys/correction-continuity.test.ts", "core/test/journeys/owner-rework-t2.test.ts",
    "core/test/journeys/owner-rework.test.ts", "core/test/journeys/production-runner.test.ts",
    "core/test/journeys/replacement-review.test.ts", "core/test/journeys/shift-adopt.test.ts",
    "core/test/journeys/shift-blocked.test.ts", "core/test/journeys/shift-ceiling.test.ts",
    "core/test/journeys/shift-milestone.test.ts", "core/test/journeys/t2-production.test.ts",
    "core/test/journeys/visual-references.test.ts", "core/test/unit/_prove-replay.ts",
  ];
  const spelling = '.replace(/^ {2}traps:.*\\n/gmu, "")';
  for (const path of paths) assert.ok(readFileSync(join(ROOT, path), "utf8").includes(spelling), path);
  for (const timeout of [30, 300, 2400]) {
    const text = `${SHIPPED}\n` .replace(/\ngates:\n/u,
      `\ngates:\n  traps: { argv: [npm, run, test:traps], timeout_seconds: ${timeout} }\n`);
    const stripped = text.replace(/^ {2}traps:.*\n/gmu, "");
    assert.equal(loadConfig(stripped).gates.traps, undefined);
  }
  assert.match(readFileSync(join(ROOT, "core/test/fixtures/trap-world.ts"), "utf8"), /delete config\.gates\.traps;/u);
});

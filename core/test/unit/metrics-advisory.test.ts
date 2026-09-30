import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../../src/cli/main.ts";
import { ADVISORY_END, KEEP_CONFIGURED, metricsAdviceCommand, metricsAdvisoryReadout } from "../../src/cli/commands/metrics-advisory.ts";
import { readMetricsPayload } from "../../src/cli/commands/metrics.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { TICKET_TASK_CLASSES } from "../../src/contracts/ticket.ts";
import { selectShiftTickets } from "../../src/workflow/shift/select.ts";
import { PlanTicketReader } from "../../src/persistence/plan-tickets.ts";
import { resolveTicketPlanSources } from "../../src/api/routes.ts";
import { observedModels, priorLookup } from "../../../dashboard/shared/benchmark-priors.ts";
import { formatListEquivalent, listPrice } from "../../../dashboard/shared/rate-card.ts";
import { depth, recommend, stats } from "../../../dashboard/shared/route-metrics.ts";
import { AT, OPUS_HIGH, phase, session, SyntheticAttempt, usage } from "./_metrics-journal.ts";
import { validConfig } from "./config/fixture.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "awsf-advisory-"));
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot);
  mkdirSync(join(root, ".git"));
  const dbPath = join(stateRoot, "awsf.db");
  const db = openDatabase(dbPath);
  try {
    for (let index = 0; index < 6; index++) {
      const id = `advice-${index}`;
      const run = new SyntheticAttempt({ ...session(id), workflowId: index === 5 ? "prove" : "build-review" });
      for (const role of ["builder", "reviewer"]) {
        const key = `${id}:${role}`;
        run.phase(phase(role, role, { phaseId: key, ordinal: role === "builder" ? 1 : 2 }));
        run.start(key, role, "claude", "anthropic", "claude:opus", { ...OPUS_HIGH, phaseId: role });
        run.event(key, key, { kind: "run.started", adapter: "claude-code", requestedModel: "opus" });
        run.event(key, key, { kind: "model.resolved", adapter: "claude-code", provider: "anthropic",
          requestedModel: "opus", resolvedModel: "claude-opus-4-6", provenance: index === 4 ? "route-attributed" : "stream-authoritative" });
        run.event(key, key, { kind: "usage", usage: usage(100_000, 10_000, 0, 0, null) });
        run.envelope(key, role, 0, "success");
        if (role === "builder") run.gate(key, 0, "writes_within_globs", true);
        else run.review(key, "accept");
        run.phase(phase(role, role, { phaseId: key, ordinal: role === "builder" ? 1 : 2, status: "SUCCEEDED", endedAt: "2026-09-26T10:10:00.000Z" }));
      }
      run.transition("AWAITING_OWNER");
      run.transition("LANDING");
      run.transition("LANDED");
      run.project(db);
    }
  } finally {
    db.close();
  }
  const config = validConfig();
  config.routing.phase_routes = { builder: { adapter: "claude", provider: "anthropic", model: "claude:opus", effort: "max" } };
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(join(root, "awsf.project.yaml"), JSON.stringify({ version: "awsf.project/v1", project: { slug: "test-project" },
    repositories: { repo: { role: "plan", default_branch: "main" } },
    plans: { root: "specs", format: "awsf-plan-html/v1", default: "fixture" } }));
  mkdirSync(join(root, "specs/tickets/fixture"), { recursive: true });
  writeFileSync(join(root, "specs/fixture.html"), "<h3>Milestone M1</h3>");
  for (const [index, taskClass] of [undefined, TICKET_TASK_CLASSES[0], TICKET_TASK_CLASSES[1]].entries()) {
    writeFileSync(join(root, `specs/tickets/fixture/T0${index + 1}.md`),
      `---\nid: T0${index + 1}\ntitle: Fixture ${index + 1}\nmilestone: M1\nstate: todo\ndepends_on: []\n${taskClass === undefined ? "" : `task_class: ${taskClass}\n`}---\n## Build prompt\n\n\`\`\`\nBuild.\n\`\`\`\n`);
  }
  return { root, stateRoot, dbPath, config, configPath };
}

async function cli(f: ReturnType<typeof fixture>, argv: string[]) {
  const out: string[] = [], err: string[] = [];
  const previous = process.cwd();
  process.chdir(f.root);
  try {
    const code = await main({ cwd: f.root, argv: [...argv, "--state-root", f.stateRoot], writeOut: (line) => out.push(line), writeError: (line) => err.push(line) });
    return { code, out, err };
  } finally { process.chdir(previous); }
}

test("advice over a synthetic database prints shared local numbers, exact route flags and unconfirmed badges without writes", async () => {
  const f = fixture();
  try {
    const digest = () => createHash("sha256").update(readFileSync(f.dbPath)).digest("hex");
    const before = digest();
    const configBefore = readFileSync(f.configPath, "utf8");
    const payload = readMetricsPayload(f.dbPath, AT);
    const rec = recommend(payload.roleRows, "builder", "unclassified", "production", { price: listPrice,
      prior: priorLookup(observedModels(payload.roleRows)), untested: payload.untestedRoutes })!;
    const s = stats(payload.roleRows.filter((row) => row.role === "builder" && row.source === "production"), listPrice);
    const result = await cli(f, ["metrics", "--advise", "--role", "builder"]);
    assert.equal(result.code, 0, result.err.join("\n"));
    const text = result.out.join("\n");
    assert.match(text, /configured route: claude\/anthropic\/claude:opus@max/);
    assert.match(text, /recommendation basis: local/);
    assert.ok(text.includes(`depth ${depth(rec.choice.firstPass, rec.choice.settled)} · n ${s.n} · settled 5`), text);
    assert.ok(text.includes(`${formatListEquivalent(rec.choice.listPerRow)} per row`), text);
    assert.match(text, /first pass 100% \[95% CI 57%–100%\]/);
    assert.match(text, /recommendation: claude\/anthropic\/opus@high \(identity unconfirmed\)/);
    assert.ok(result.out.includes("  --route builder=claude/anthropic/opus@high"));
    assert.equal(result.out.at(-1), ADVISORY_END);
    assert.doesNotMatch(text, /reviewer|n 6/);
    assert.equal(digest(), before);
    assert.equal(readFileSync(f.configPath, "utf8"), configBefore);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("selected role/class blocks are identical in metrics --advise and shift plan after admission", async () => {
  const f = fixture();
  try {
    const advice = await cli(f, ["metrics", "--advise", "--plan", "fixture", "--milestone", "M1"]);
    const plan = await cli(f, ["shift", "plan", "fixture", "--milestone", "M1"]);
    assert.equal(advice.code, 0, advice.err.join("\n"));
    assert.equal(plan.code, 0, plan.err.join("\n"));
    const start = plan.out.findIndex((line) => line.startsWith("Route advisory"));
    assert.ok(start > plan.out.findIndex((line) => line.startsWith("remaining headroom")));
    assert.deepEqual(plan.out.slice(start), advice.out);
    assert.equal(advice.out.filter((line) => line === ADVISORY_END).length, 6);
    for (const role of ["builder", "reviewer"]) {
      for (const taskClass of [...TICKET_TASK_CLASSES.slice(0, 2), "unclassified"]) {
        assert.ok(advice.out.includes(`Route advisory · ${role} · ${taskClass} · production evidence`));
      }
    }
    const selected = await cli(f, ["metrics", "--advise", "--plan", "fixture", "--milestone", "M1", "--role", "reviewer"]);
    assert.equal(selected.out.filter((line) => line === ADVISORY_END).length, 3);
    assert.doesNotMatch(selected.out.join("\n"), /Route advisory · builder/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("empty evidence keeps configured routes; priors are explicitly prior only and never pool classes", async () => {
  const f = fixture();
  try {
    const payload = readMetricsPayload(f.dbPath, AT);
    const previous = process.cwd();
    process.chdir(f.root);
    let reader: PlanTicketReader;
    try { reader = new PlanTicketReader(resolveTicketPlanSources(f.root)); }
    finally { process.chdir(previous); }
    const selection = selectShiftTickets("fixture", ["M1"], (await reader.load()).flatMap((group) => group.records));
    const empty = { ...payload, roleRows: [], untestedRoutes: [] };
    const kept = await metricsAdvisoryReadout(empty, { config: f.config, selection });
    assert.equal(kept.filter((line) => line.trim() === KEEP_CONFIGURED).length, 6);
    assert.equal(kept.filter((line) => line === ADVISORY_END).length, 6);
    const prior = await metricsAdvisoryReadout({ ...payload, roleRows: [] }, { config: f.config, role: "builder" });
    assert.ok(prior.includes("  recommendation basis: prior only"));
    assert.ok(prior.some((line) => line.startsWith("  --route builder=")));
    const classified = { ...payload, roleRows: payload.roleRows.map((row, index) => ({ ...row,
      taskClass: index < 2 ? TICKET_TASK_CLASSES[0] : TICKET_TASK_CLASSES[1] })) };
    const lines = await metricsAdvisoryReadout(classified, { config: f.config, role: "builder" });
    assert.equal(lines.filter((line) => line.startsWith("Route advisory")).length, 2);
    assert.ok(lines.filter((line) => line.startsWith("  recommendation basis:")).every((line) => line.endsWith("prior only")));
    assert.doesNotMatch(lines.join("\n"), /settled 5/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("advise flag parsing and refusals preserve the ordinary table's broader role vocabulary", async () => {
  const f = fixture();
  try {
    for (const flags of [
      ["--json"], ["--role", "planner"], ["--plan", "fixture"], ["--milestone", "M1"],
      ["--source", "proving-ground"], ["--task-class", TICKET_TASK_CLASSES[0]], ["--started-before", AT],
      ["--plan", "fixture", "--milestone", "missing"],
    ]) assert.equal((await cli(f, ["metrics", "--advise", ...flags])).code, 1, flags.join(" "));
    assert.equal((await cli(f, ["metrics", "--role", "planner"])).code, 0);
    assert.equal((await cli(f, ["metrics", "--milestone", "M1"])).code, 1);
    await assert.rejects(metricsAdviceCommand({ ...f, dbPath: join(f.root, "absent.db"), extractedAt: AT }), /no projection/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("missing metrics and evidence cannot alter the ceiling refusal or admit a selection", async () => {
  const f = fixture();
  try {
    const tight = { ...f.config, risk: { ...f.config.risk, call_ceiling: { T0: 1, T1: 3, T2: 3 } } };
    writeFileSync(f.configPath, JSON.stringify(tight));
    rmSync(f.dbPath);
    const result = await cli(f, ["shift", "plan", "fixture", "--milestone", "M1"]);
    assert.equal(result.code, 1);
    assert.match(result.err.join("\n"), /CallCeilingExceeded.*needs 1 awsf raise act\(s\)/);
    assert.match(result.out.join("\n"), /evidence unavailable: no projection/);
    assert.equal(result.out.filter((line) => line === ADVISORY_END).length, 6);
    assert.equal(result.out.filter((line) => line.trim() === KEEP_CONFIGURED).length, 6);
    const normal = { ...f.config, risk: { ...f.config.risk, call_ceiling: { T0: 1, T1: 3, T2: 5 } } };
    writeFileSync(f.configPath, JSON.stringify(normal));
    assert.equal((await cli(f, ["shift", "plan", "fixture", "--milestone", "M1"])).code, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { runProductionCommand, ProductionQuotaRefused } from "../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import { assertRefusedBeforeSpend, refusalAssertion } from "../traps/_harness.ts";
import { AT, box, draft, prepare, start, assertCalled } from "./trap-world.ts";

export interface StartQuotaScenario {
  readonly id: "TR-14" | "TR-15";
  readonly condition?: "exhausted" | "rejected" | "below-threshold";
  readonly threshold?: number;
  readonly minutes?: number;
  readonly unavailable?: "missing" | "timeout" | "stale" | "unparseable";
  readonly unusedExhausted?: boolean;
  readonly secondRoute?: boolean;
  readonly byAdapter?: boolean;
  readonly multipleScopes?: boolean;
  readonly unknownBinding?: "unknown-runway" | "no-single-window" | "missing-reset";
  readonly allow?: boolean;
}

/** Canned schema, local reset instants and stub adapters only; no owner state. */
export async function runStartQuota(scenario: StartQuotaScenario) {
  const world = box(config => {
    delete config.routing.quota_stop;
    if (scenario.threshold !== undefined) config.routing.quota_stop = scenario.byAdapter
      ? { default: { minutes: 1, probe_timeout_ms: 1000 }, by_adapter: { claude: { minutes: scenario.threshold, probe_timeout_ms: 1000 } } }
      : { default: { minutes: scenario.threshold, probe_timeout_ms: 1000 } };
    if (!scenario.secondRoute) {
      const builder = config.agents.find(agent => agent.name === "builder")!;
      builder.harness.adapter = "claude";
      builder.model = config.agents.find(agent => agent.name === "planner")!.model;
    }
  });
  const label = refusalAssertion(scenario.id);
  try {
    const created = await draft(world, undefined, scenario.secondRoute ? "build-review" : "build");
    await prepare(world, created.attemptDir);
    const prepared = await start(world, created.attemptDir);
    const trees = readdirSync(world.worktreeRoot);
    const data = JSON.parse(readFileSync("core/test/fixtures/quota-axi/nominal.json", "utf8"));
    const resetsAt = new Date(Date.parse(AT) + (scenario.minutes ?? 1440) * 60_000).toISOString();
    data.generatedAt = AT;
    for (const provider of data.providers) {
      for (const window of provider.windows) window.resetsAt = resetsAt;
      for (const scope of provider.quotaSemantics.effectiveAvailability) {
        scope.effectivePercentRemaining = 50;
        const exhausted = provider.provider === (scenario.unusedExhausted ? "codex" : "claude");
        if (exhausted && scenario.condition !== "below-threshold") scope.effectivePercentRemaining = 0;
        if (exhausted && scenario.condition === "rejected") scope.status = "rejected";
        if (exhausted && scenario.unknownBinding === "unknown-runway") scope.runway = { status: "unknown" };
        if (exhausted && scenario.unknownBinding === "no-single-window") scope.limitingWindowIds = [];
        if (exhausted && scenario.unknownBinding === "missing-reset") {
          for (const window of provider.windows) window.resetsAt = null;
        }
      }
      if (scenario.unavailable === "stale") provider.state.status = "stale";
      if (scenario.multipleScopes && provider.provider === "claude") {
        const exhausted = structuredClone(provider.quotaSemantics.effectiveAvailability[0]);
        provider.quotaSemantics.effectiveAvailability[0].effectivePercentRemaining = 50;
        exhausted.scope = "other_models";
        provider.quotaSemantics.effectiveAvailability.push(exhausted);
      }
    }
    const commands: string[][] = [];
    let failure: unknown;
    try {
      const status = await runProductionCommand({ attemptDir: created.attemptDir, stateRoot: world.stateRoot,
        config: world.config, configPath: world.configPath, projectRecord: world.projection.project,
        infrastructure: { ...world.infrastructure,
          resolveExecutable: () => {
            if (scenario.unavailable === "missing") throw new Error("synthetic executable missing");
            return "/synthetic/quota-axi";
          },
          runCommand: (executable, argv, options) => {
            assert.equal(executable, "/synthetic/quota-axi");
            assert.equal(options.cwd, prepared.worktree);
            assert.equal(options.env, process.env);
            commands.push([...argv]);
            if (scenario.unavailable === "timeout") return { status: null, stdout: "", stderr: "", error: "ETIMEDOUT" };
            return { status: 0, stdout: argv[0] === "--version" ? "quota-axi 0.1.29"
              : scenario.unavailable === "unparseable" ? "not JSON" : JSON.stringify(data), stderr: "", error: null };
          } } });
      if (scenario.allow) assertCalled(world, status);
    } catch (error) { failure = error; }
    const status = await readAttempt(created.attemptDir);
    const evidence = await readAttemptEvidence(created.attemptDir);
    if (scenario.allow) {
      assert.equal(failure, undefined, label);
      assert.equal(world.calls.length, 1, label);
      if (scenario.unavailable !== undefined) assert.ok(evidence.some(row => row.type === "quota-snapshot" && row.completedPhaseKey === "before-l4" && row.reasonCode !== null));
    } else {
      assertRefusedBeforeSpend({ id: scenario.id, expectedRefusal: "ProductionQuotaRefused",
        observedRefusal: failure instanceof Error ? failure.name : null, status, world });
      assert.ok(failure instanceof ProductionQuotaRefused, label);
      assert.equal(failure.condition, scenario.condition ?? "exhausted", label);
      assert.equal(failure.provider, "claude", label);
      if (scenario.unknownBinding === undefined) {
        assert.equal(failure.window, "seven_day", label);
        assert.equal(failure.resetsAt, resetsAt, label);
        assert.match(failure.message, /before L4.*provider claude.*window seven_day.*resets at/u, label);
      } else {
        assert.equal(failure.window, null, label);
        assert.equal(failure.resetsAt, null, label);
        assert.equal(failure.scope, "all_models", label);
        assert.match(failure.message, /before L4.*provider claude.*scope all_models.*window and reset were not measured/u, label);
      }
      assert.equal(status.lifecycleState, "PREPARED", label);
      assert.equal(status.worktree, prepared.worktree, label);
      assert.deepEqual(readdirSync(world.worktreeRoot), trees, `${label}: no new tree`);
      assert.equal(evidence.some(row => row.type === "transition" && row.from === "PREPARED"), false, label);
    }
    if (scenario.unavailable !== "missing" && scenario.unavailable !== "timeout") {
      assert.deepEqual(commands.slice(0, 2), [["--version"], ["--provider", scenario.secondRoute ? "claude,codex" : "claude", "--json"]], `${label}: recipe routes only`);
      if (!scenario.allow) assert.equal(commands.length, 2, `${label}: exactly one probe before refusal`);
    }
    return { status, commands };
  } finally { world.close(); }
}

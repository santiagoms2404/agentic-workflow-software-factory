#!/usr/bin/env -S node --experimental-strip-types

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { toConfigSnapshotJson } from "../config/effective-config.ts";
import { loadConfig } from "../config/load.ts";
import { loadCatalog } from "../registry/catalog.ts";
import { resolvePlanSources } from "../registry/plan-source.ts";
import { resolveStateRoot } from "../persistence/platform-paths.ts";
import { callCeilingsOf } from "../state/tiers.ts";
import { processOwnerTerminal, type OwnerTerminal } from "./tty.ts";
import { adoptCommand } from "./commands/adopt.ts";
import { backlogCommand } from "./commands/backlog.ts";
import { cancelCommand } from "./commands/cancel.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { dashCommand, gcCommand, rebuildCommand } from "./commands/operator.ts";
import { createDashboardProjection } from "./commands/dashboard-projection.ts";
import { journeyCommand } from "./commands/journey.ts";
import { initCommand } from "./commands/init.ts";
import { listProjects, registerProject, showProject, verifyRegisteredProject } from "./commands/project.ts";
import { landCommand } from "./commands/land.ts";
import { newCommand } from "./commands/new.ts";
import { publishCommand } from "./commands/publish.ts";
import { raiseCommand } from "./commands/raise.ts";
import { quotaCommand } from "./commands/quota.ts";
import { stageCommand } from "./commands/stage.ts";
import { locateAttempt } from "./commands/attempt.ts";
import { retryCommand } from "./commands/retry.ts";
import { reviewCommand } from "./commands/review.ts";
import { reworkCommand } from "./commands/rework.ts";
import { runStubCommand } from "./commands/run.ts";
import { runProductionCommand } from "./commands/production-run.ts";
import { defaultWorktreeRoot, startCommand } from "./commands/start.ts";
import { statusCommand } from "./commands/status.ts";
import { intakeRequest, listTickets, showTicket, ticketStoreFor, ticketStoreForPlan } from "./commands/ticket.ts";
import { watchCommand } from "./commands/watch.ts";
import { selectWorkflow, workflowsCommand } from "./commands/workflows.ts";

/** The complete owner-facing command table; documentation reconciles against it. */
export const CLI_COMMANDS = Object.freeze([
  "init", "project", "new", "start", "run", "status", "watch", "rework", "review", "raise", "journey", "land", "publish", "cancel", "retry",
  "doctor", "gc", "dash", "db rebuild", "ticket", "backlog", "quota", "stage", "workflows", "group",
]);

const USAGE = `usage: awsf init [path] --project <slug>\n       awsf <${CLI_COMMANDS.join("|")}> [task] [options]`;

/** Flags that take no value. Documentation reconciles against this too. */
export const CLI_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["evidence"]);

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
  readonly repositories: readonly string[];
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  const repositories: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals > 2) {
      const key = arg.slice(2, equals);
      const value = arg.slice(equals + 1);
      if (key === "repository") repositories.push(value);
      else flags[key] = value;
      continue;
    }
    const key = arg.slice(2);
    const value = args[index + 1];
    if (CLI_BOOLEAN_FLAGS.has(key)) {
      // `--stub true`, `--tier T2`, `--live-ms 0`: the value spelling is what
      // every other flag in this CLI uses, so a driver types `--evidence true`
      // and used to bind the task id to `true` — silently, with the error
      // telling them to create a task by that name. Consume the token when it
      // IS the boolean, and only then; `--evidence TASK` must still leave TASK
      // a positional. A task literally named `true` or `false` is spelled
      // `--evidence=true TASK`.
      const spelled = value === "true" || value === "false";
      flags[key] = spelled ? value : "true";
      if (spelled) index += 1;
      continue;
    }
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    if (key === "repository") repositories.push(value);
    else flags[key] = value;
    index += 1;
  }
  return { positionals, flags, repositories };
}

function commandEnvironment(env: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

class PlanSelectionRequiredError extends Error {
  readonly candidates: readonly string[];

  constructor(candidates: readonly string[]) {
    super("--plan is required when this catalog has no default plan");
    this.name = "PlanSelectionRequiredError";
    this.candidates = candidates;
  }
}

/** Uses a catalog when present, while retaining the original self-placed store otherwise. */
async function ticketStoreForList(repository: string, requestedPlan: string | undefined) {
  let source: string;
  try {
    source = await readFile(resolve(repository, "awsf.project.yaml"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ticketStoreFor(repository);
    throw error;
  }

  const catalog = loadCatalog(source);
  const resolved = resolvePlanSources(resolve(repository, "awsf.project.yaml"), catalog);
  const candidates = resolved.map((plan) => basename(plan.planPath, ".html"));
  const planStem = requestedPlan ?? catalog.plans.default;
  if (planStem === undefined) {
    if (candidates.length > 1) throw new PlanSelectionRequiredError(candidates);
    if (candidates.length === 0) throw new Error(`catalog ${JSON.stringify(resolve(repository, "awsf.project.yaml"))} resolved no plan sources`);
    return ticketStoreForPlan(resolved, candidates[0]!);
  }

  const store = ticketStoreForPlan(resolved, planStem);
  // Task 20 moves the existing flat default set after this resolver exists.
  // Until then, the declared default retains the single-repository behaviour.
  return !existsSync(store.directory) && planStem === catalog.plans.default
    ? ticketStoreFor(repository)
    : store;
}

function adoptionTerminal(provided: OwnerTerminal | undefined): OwnerTerminal {
  return provided ?? processOwnerTerminal();
}

export interface CliMainOptions {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly terminal?: OwnerTerminal;
  readonly writeOut?: (line: string) => void;
  readonly writeError?: (line: string) => void;
}

export async function main(options: CliMainOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const out = options.writeOut ?? ((line: string): void => { process.stdout.write(`${line}\n`); });
  const err = options.writeError ?? ((line: string): void => { process.stderr.write(`${line}\n`); });
  try {
    const command = argv[0];
    if (command === undefined) throw new Error(USAGE);
    const parsed = parseArgs(argv.slice(1));
    const stateRoot = parsed.flags["state-root"] === undefined
      ? resolveStateRoot(env)
      : resolve(parsed.flags["state-root"]);
    if (command === "group") {
      // Loaded only on the planning route. Ordinary attempts never read a group or packet.
      const { groupCommand } = await import("./commands/group.ts");
      const text = await groupCommand({ args: argv.slice(1), stateRoot, cwd,
        ...(options.terminal === undefined ? {} : { terminal: options.terminal }) });
      if (options.writeOut) options.writeOut(text);
      else process.stdout.write(text);
      return 0;
    }
    if (command === "doctor") {
      const report = await doctorCommand(stateRoot);
      for (const line of report.lines) out(line);
      return report.healthy ? 0 : 1;
    }
    if (command === "gc") {
      const candidates = await gcCommand(stateRoot);
      if (candidates.length === 0) out("No cleanup candidates. awsf gc lists only and deletes nothing.");
      else for (const candidate of candidates) out(candidate);
      return 0;
    }
    if (command === "dash") {
      const configPath = resolve(parsed.flags.config ?? `${cwd}/awsf.config.yaml`);
      const config = loadConfig(await readFile(configPath, "utf8"));
      const port = parsed.flags.port === undefined ? undefined : Number(parsed.flags.port);
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) throw new Error("--port must be an integer from 1 through 65535");
      return (await dashCommand({ cwd, write: out, config, dbPath: resolve(stateRoot, "awsf.db"), ...(port === undefined ? {} : { port }) })) === "not-built" ? 1 : 0;
    }
    if (command === "db") {
      if (parsed.positionals[0] !== "rebuild" || parsed.positionals.length !== 1) throw new Error("usage: awsf db rebuild [--state-root PATH]");
      const report = await rebuildCommand(stateRoot);
      if (report.ok) {
        out(`Rebuilt ${report.targetPath}: ${report.sessions} session(s), ${report.records} record(s).`);
        return 0;
      }
      out(`Rebuild refused: ${report.reason}; candidate retained at ${report.candidatePath}`);
      return 1;
    }
    if (command === "quota") {
      if (parsed.positionals.length !== 0) throw new Error("usage: awsf quota [--catalog PATH] [--state-root PATH]");
      const report = await quotaCommand({
        catalogPath: resolve(parsed.flags.catalog ?? `${cwd}/awsf.project.yaml`),
        stateRoot,
        env: commandEnvironment(env),
      });
      for (const line of report.lines) out(line);
      return 0;
    }
    if (command === "stage") {
      const unsupportedFlags = Object.keys(parsed.flags).filter((flag) => flag !== "catalog" && flag !== "state-root");
      if (parsed.positionals.length !== 0 || parsed.repositories.length !== 0 || unsupportedFlags.length !== 0) {
        throw new Error("usage: awsf stage [--catalog PATH] [--state-root PATH]");
      }
      for (const line of await stageCommand({
        catalogPath: resolve(parsed.flags.catalog ?? `${cwd}/awsf.project.yaml`),
        stateRoot,
      })) out(line);
      return 0;
    }
    if (command === "backlog") {
      if (parsed.positionals.length !== 0) throw new Error("usage: awsf backlog [--state-root PATH] [--plan <stem>]");
      try {
        for (const line of await backlogCommand(await ticketStoreForList(cwd, parsed.flags.plan), resolve(stateRoot, "awsf.db"))) out(line);
        return 0;
      } catch (error) {
        if (!(error instanceof PlanSelectionRequiredError)) throw error;
        out(`plan candidates: ${error.candidates.join(", ")}`);
        return 1;
      }
    }
    if (command === "ticket") {
      const action = parsed.positionals[0];
      const store = ticketStoreFor(cwd);
      if (action === "list" && parsed.positionals.length === 1) {
        try {
          for (const line of await listTickets(await ticketStoreForList(cwd, parsed.flags.plan))) out(line);
          return 0;
        } catch (error) {
          if (!(error instanceof PlanSelectionRequiredError)) throw error;
          out(`plan candidates: ${error.candidates.join(", ")}`);
          return 1;
        }
      }
      if (action === "show" && parsed.positionals.length === 2) {
        for (const line of await showTicket(await ticketStoreForList(cwd, parsed.flags.plan), parsed.positionals[1]!)) out(line);
        return 0;
      }
      if (action !== "new" && action !== "refine") {
        throw new Error("usage: awsf ticket <new ID INTENT|refine ID INTENT|list|show ID>");
      }
      const id = parsed.positionals[1] ?? "";
      const intent = parsed.positionals.slice(2).join(" ");
      const loaded = await store.load();
      const existing = loaded.find((record) => record.ticket?.id === id);
      if (action === "new" && existing !== undefined) throw new Error(`ticket ${id} already exists; use awsf ticket refine`);
      const request = intakeRequest(action, id, intent, existing);
      const configPath = resolve(parsed.flags.config ?? `${cwd}/awsf.config.yaml`);
      const config = loadConfig(await readFile(configPath, "utf8"));
      if (!config.workflows.enabled.includes("intake")) throw new Error("the intake workflow is not enabled");
      const project = parsed.flags.project ?? config.project.slug;
      // Each intake/refinement is a distinct task-lifetime budget. Reusing a
      // prior T0 task would either collide or make a second refinement inherit
      // its already-spent one-call ceiling.
      const taskId = `ticket-${action}-${id}-${randomUUID()}`;
      const projection = createDashboardProjection(stateRoot, err);
      try {
        const created = await newCommand({
          stateRoot, project, taskId, repository: cwd, request, workflow: "intake", tier: 0,
          configSnapshotJson: toConfigSnapshotJson(config),
          callCeilings: callCeilingsOf(config.risk.call_ceiling),
          allowance: config.risk.correction_allowance,
          projectRecord: projection.project,
        });
        await startCommand({
          attemptDir: created.attemptDir,
          worktreeRoot: resolve(parsed.flags["worktree-root"] ?? env.AWSF_WORKTREE_ROOT ?? defaultWorktreeRoot(stateRoot)),
          configPath,
          projectRecord: projection.project,
        });
        const status = await runProductionCommand({
          attemptDir: created.attemptDir, stateRoot, config, configPath,
          projectRecord: projection.project,
          assertAdvancement: projection.assertAdvancement,
          assertLaunchProjection: projection.assertLaunchPermitted,
        });
        out(`${status.lifecycleState}: ${status.nextAction}`);
        out(`Validated intake candidate for ${id}; inspect it, then run awsf land ${taskId}.`);
        return status.lifecycleState === "AWAITING_OWNER" ? 0 : 1;
      } finally {
        projection.close();
      }
    }

    if (command === "init") {
      if (parsed.positionals.length > 1) throw new Error("usage: awsf init [path] --project <slug>");
      const slug = parsed.flags.project;
      if (slug === undefined) throw new Error("usage: awsf init [path] --project <slug>");
      const result = await initCommand({ path: parsed.positionals[0] ?? cwd, slug });
      out(result.line);
      return 0;
    }

    if (command === "workflows") {
      if (parsed.positionals.length !== 0 || parsed.repositories.length !== 0) {
        throw new Error("usage: awsf workflows [--config PATH]");
      }
      const configPath = resolve(parsed.flags.config ?? `${cwd}/awsf.config.yaml`);
      const config = loadConfig(await readFile(configPath, "utf8"));
      for (const line of workflowsCommand(config)) out(line);
      return 0;
    }

    if (command === "project") {
      const action = parsed.positionals[0];
      if (action === "register" && parsed.positionals.length === 1) {
        const catalogPath = parsed.flags.catalog;
        if (catalogPath === undefined || parsed.repositories.length === 0) {
          throw new Error("usage: awsf project register --catalog <path> --repository <id>=<absolute-path> [...]");
        }
        const result = await registerProject({ stateRoot, catalogPath: resolve(catalogPath), repositories: parsed.repositories });
        out(result.line);
        return 0;
      }
      if (action === "list" && parsed.positionals.length === 1) {
        for (const line of await listProjects(stateRoot)) out(line);
        return 0;
      }
      if (action === "show" && parsed.positionals.length === 2) {
        for (const line of await showProject(stateRoot, parsed.positionals[1]!)) out(line);
        return 0;
      }
      if (action === "verify" && parsed.positionals.length === 2) {
        const report = await verifyRegisteredProject(stateRoot, parsed.positionals[1]!);
        for (const line of report.lines) out(line);
        return report.ok ? 0 : 1;
      }
      throw new Error("usage: awsf project <register|list|show|verify> [options]");
    }

    const taskId = parsed.positionals[0];
    if (taskId === undefined) throw new Error(USAGE);
    const configPath = resolve(parsed.flags.config ?? `${cwd}/awsf.config.yaml`);
    const config = loadConfig(await readFile(configPath, "utf8"));
    const project = parsed.flags.project ?? config.project.slug;
    const selectedAttempt = parsed.flags.attempt === undefined ? undefined : Number(parsed.flags.attempt);
    const projection = createDashboardProjection(stateRoot, err);

    try {
    if (command === "new") {
      const request = parsed.positionals.slice(1).join(" ").trim();
      if (request.length === 0) throw new Error("awsf new requires a request after the task id");
      const selection = selectWorkflow(
        config,
        parsed.flags.workflow ?? config.project.default_workflow,
        parsed.flags.tier,
      );
      const { workflow, tier } = selection;
      const result = await newCommand({
        stateRoot,
        project,
        taskId,
        ...(parsed.flags.continues === undefined ? {} : { continuesTask: parsed.flags.continues }),
        repository: cwd,
        request,
        workflow,
        tier,
        configSnapshotJson: toConfigSnapshotJson(config),
        callCeilings: callCeilingsOf(config.risk.call_ceiling),
        allowance: config.risk.correction_allowance,
        projectRecord: projection.project,
      });
      out(`Created ${project}/${taskId} attempt ${result.status.attempt} in DRAFT.`);
      out(result.status.nextAction);
      return 0;
    }

    const located = await locateAttempt(stateRoot, project, taskId, selectedAttempt);
    switch (command) {
      case "start": {
        const status = await startCommand({
          attemptDir: located.attemptDir,
          worktreeRoot: resolve(parsed.flags["worktree-root"] ?? env.AWSF_WORKTREE_ROOT ?? defaultWorktreeRoot(stateRoot)),
          configPath,
          ...(parsed.flags.stub === "true" ? { preflight: () => ({ adapter: true, sandbox: true, observability: true }) } : {}),
          projectRecord: projection.project,
        });
        out(`Prepared ${taskId} at ${status.baseSha}.`);
        out(status.nextAction);
        return 0;
      }
      case "run": {
        if (parsed.flags.stub === "true") {
          const liveMs = parsed.flags["live-ms"] === undefined ? 0 : Number(parsed.flags["live-ms"]);
          if (!Number.isInteger(liveMs) || liveMs < 0 || liveMs > 60_000) throw new Error("--live-ms must be an integer from 0 through 60000");
          const status = await runStubCommand(located.attemptDir, {
            liveMs,
            projectRecord: projection.project,
            assertAdvancement: projection.assertAdvancement,
          });
          out(`${status.lifecycleState}: ${status.nextAction}`);
          return 0;
        }
        const status = await runProductionCommand({
          attemptDir: located.attemptDir,
          stateRoot,
          config,
          configPath,
          projectRecord: projection.project,
          assertAdvancement: projection.assertAdvancement,
          assertLaunchProjection: projection.assertLaunchPermitted,
        });
        out(`${status.lifecycleState}: ${status.nextAction}`);
        const reportLine = (await statusCommand(located.attemptDir)).find((line) => line.startsWith("Run report:"));
        if (reportLine !== undefined) out(reportLine);
        return status.lifecycleState === "AWAITING_OWNER" ? 0 : 1;
      }
      case "status":
        for (const line of await statusCommand(located.attemptDir, { evidence: parsed.flags.evidence === "true" })) out(line);
        return 0;
      case "watch":
        await watchCommand({ attemptDir: located.attemptDir, pollMs: config.observability.poll_ms, write: out });
        return 0;
      case "rework": {
        const defect = parsed.positionals.slice(1).join(" ");
        const result = await reworkCommand({
          attemptDir: located.attemptDir,
          stateRoot,
          defect,
          terminal: options.terminal ?? processOwnerTerminal(),
          config,
          configPath,
          projectRecord: projection.project,
          assertAdvancement: projection.assertAdvancement,
          assertLaunchProjection: projection.assertLaunchPermitted,
        });
        if (!result.confirmed) {
          out("Rework declined; state remains AWAITING_OWNER and no call was spent.");
          return 1;
        }
        out(`${result.status.lifecycleState}: ${result.status.nextAction}`);
        return result.status.lifecycleState === "AWAITING_OWNER" ? 0 : 1;
      }
      case "review": {
        const reason = parsed.flags["reason"] ?? "";
        if (reason.trim().length === 0) {
          throw new Error('usage: awsf review <task> --reason "<why the recorded review is not evidence>"');
        }
        const result = await reviewCommand({
          attemptDir: located.attemptDir,
          stateRoot,
          reason,
          terminal: options.terminal ?? processOwnerTerminal(),
          config,
          configPath,
          projectRecord: projection.project,
          assertAdvancement: projection.assertAdvancement,
          assertLaunchProjection: projection.assertLaunchPermitted,
        });
        if (!result.confirmed) {
          out("Replacement review declined; state remains AWAITING_OWNER and no call was spent.");
          return 1;
        }
        out(`${result.status.lifecycleState}: ${result.status.nextAction}`);
        return result.status.lifecycleState === "AWAITING_OWNER" ? 0 : 1;
      }
      case "raise": {
        const reason = parsed.flags["reason"] ?? "";
        const calls = parsed.flags["calls"] === undefined ? 1 : Number(parsed.flags["calls"]);
        if (reason.trim().length === 0) {
          throw new Error('usage: awsf raise <task> --calls <n> --reason "<why this task is worth more calls>"');
        }
        const result = await raiseCommand({
          attemptDir: located.attemptDir,
          calls,
          reason,
          terminal: options.terminal ?? processOwnerTerminal(),
          projectRecord: projection.project,
        });
        if (!result.confirmed) {
          out(`Raise declined; the ceiling remains ${result.ceiling} call(s) and nothing was recorded.`);
          return 1;
        }
        out(`Ceiling raised to ${result.ceiling} call(s) for ${taskId}; the grant and your reason are journalled.`);
        out(result.status.nextAction);
        return 0;
      }
      case "journey": {
        const journeyId = parsed.flags["journey"] ?? "";
        const observedSha = parsed.flags["sha"] ?? "";
        if (journeyId.trim().length === 0 || observedSha.trim().length === 0) {
          throw new Error("usage: awsf journey <task> --journey <id> --sha <revision you exercised>");
        }
        const result = await journeyCommand({
          attemptDir: located.attemptDir,
          terminal: options.terminal ?? processOwnerTerminal(),
          journeyId,
          observedSha,
          projectRecord: projection.project,
        });
        if (!result.confirmed) {
          out("Journey not attested; journeyApproved remains false and nothing was recorded.");
          return 1;
        }
        out(`journey recorded: ${result.status.nextAction}`);
        return 0;
      }
      case "land": {
        const result = await landCommand({
          attemptDir: located.attemptDir,
          terminal: options.terminal ?? processOwnerTerminal(),
          projectRecord: projection.project,
          assertAdvancement: projection.assertAdvancement,
        });
        if (!result.confirmed) {
          out("Landing declined; state remains AWAITING_OWNER.");
          return 1;
        }
        out(`${result.status.lifecycleState}: ${result.status.lastActivity}`);
        return result.status.lifecycleState === "LANDED" ? 0 : 1;
      }
      case "publish": {
        const result = await publishCommand({
          attemptDir: located.attemptDir,
          stateRoot,
          terminal: options.terminal ?? processOwnerTerminal(),
          projectRecord: projection.project,
          assertAdvancement: projection.assertAdvancement,
        });
        if (result.outcome === "declined") {
          out("Publication declined; state remains LANDED and nothing was pushed or recorded.");
          return 1;
        }
        if (result.outcome !== "published") {
          out(result.detail);
          return 1;
        }
        out(`${result.status.lifecycleState}: ${result.status.lastActivity}`);
        return result.status.lifecycleState === "PUBLISHED" ? 0 : 1;
      }
      case "cancel": {
        const result = await cancelCommand({
          attemptDir: located.attemptDir,
          terminal: options.terminal ?? processOwnerTerminal(),
          projectRecord: projection.project,
        });
        out(`${result.status.lifecycleState}: survivors [${result.report.survivors.join(", ")}]`);
        return result.status.lifecycleState === "CANCELLED" ? 0 : 1;
      }
      case "retry": {
        const targetTaskId = parsed.flags["adopt-as"];
        if (targetTaskId !== undefined) {
          const adopted = await adoptCommand({
            sourceAttemptDir: located.attemptDir,
            stateRoot,
            targetTaskId,
            worktreeRoot: resolve(parsed.flags["worktree-root"] ?? env.AWSF_WORKTREE_ROOT ?? defaultWorktreeRoot(stateRoot)),
            terminal: adoptionTerminal(options.terminal),
            config,
            configPath,
            projectRecord: projection.project,
            assertAdvancement: projection.assertAdvancement,
            assertLaunchProjection: projection.assertLaunchPermitted,
          });
          if (!adopted.confirmed || adopted.status === null) {
            out("Adoption declined; no target was created and the source is unchanged.");
            return 1;
          }
          out(`Created ${project}/${targetTaskId} continuing ${taskId} at exact candidate ${adopted.status.candidateSha}.`);
          out(`${adopted.status.lifecycleState}: ${adopted.status.nextAction}`);
          return adopted.status.lifecycleState === "AWAITING_OWNER" ? 0 : 1;
        }
        const result = await retryCommand({
          attemptDir: located.attemptDir,
          stateRoot,
          configSnapshotJson: toConfigSnapshotJson(config),
          callCeilings: callCeilingsOf(config.risk.call_ceiling),
          allowance: config.risk.correction_allowance,
          projectRecord: projection.project,
        });
        out(`Created attempt ${result.status.attempt} in DRAFT with ${result.status.budget.callsSpent} spent call(s) carried.`);
        out(result.status.nextAction);
        return 0;
      }
      default:
        throw new Error(USAGE);
    }
    } finally {
      projection.close();
    }
  } catch (error) {
    err(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main();
}

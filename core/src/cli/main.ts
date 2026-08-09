#!/usr/bin/env -S node --experimental-strip-types

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config/load.ts";
import { resolveStateRoot } from "../persistence/platform-paths.ts";
import type { Tier } from "../state/tiers.ts";
import { processOwnerTerminal, type OwnerTerminal } from "./tty.ts";
import { cancelCommand } from "./commands/cancel.ts";
import { landCommand } from "./commands/land.ts";
import { newCommand } from "./commands/new.ts";
import { locateAttempt } from "./commands/attempt.ts";
import { retryCommand } from "./commands/retry.ts";
import { defaultWorktreeRoot, startCommand } from "./commands/start.ts";
import { statusCommand } from "./commands/status.ts";
import { watchCommand } from "./commands/watch.ts";

const USAGE = "usage: awsf <new|start|status|watch|land|cancel|retry> <task> [options]";

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals > 2) {
      flags[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const key = arg.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    flags[key] = value;
    index += 1;
  }
  return { positionals, flags };
}

function tierOf(value: string): Tier {
  const number = Number(value.replace(/^T/, ""));
  if (number !== 0 && number !== 1 && number !== 2) throw new Error(`tier must be 0, 1, or 2; got ${value}`);
  return number;
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
    const taskId = parsed.positionals[0];
    if (taskId === undefined) throw new Error(USAGE);

    const configPath = resolve(parsed.flags.config ?? `${cwd}/awsf.config.yaml`);
    const config = loadConfig(await readFile(configPath, "utf8"));
    const project = parsed.flags.project ?? config.project.slug;
    const stateRoot = parsed.flags["state-root"] === undefined
      ? resolveStateRoot(env)
      : resolve(parsed.flags["state-root"]);
    const selectedAttempt = parsed.flags.attempt === undefined ? undefined : Number(parsed.flags.attempt);

    if (command === "new") {
      const request = parsed.positionals.slice(1).join(" ").trim();
      if (request.length === 0) throw new Error("awsf new requires a request after the task id");
      const result = await newCommand({
        stateRoot,
        project,
        taskId,
        repository: cwd,
        request,
        workflow: parsed.flags.workflow ?? config.project.default_workflow,
        tier: tierOf(parsed.flags.tier ?? config.risk.default),
        allowance: config.risk.correction_allowance,
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
        });
        out(`Prepared ${taskId} at ${status.baseSha}.`);
        out(status.nextAction);
        return 0;
      }
      case "status":
        for (const line of await statusCommand(located.attemptDir)) out(line);
        return 0;
      case "watch":
        await watchCommand({ attemptDir: located.attemptDir, pollMs: config.observability.poll_ms, write: out });
        return 0;
      case "land": {
        const result = await landCommand({
          attemptDir: located.attemptDir,
          terminal: options.terminal ?? processOwnerTerminal(),
        });
        if (!result.confirmed) {
          out("Landing declined; state remains AWAITING_OWNER.");
          return 1;
        }
        out(`${result.status.lifecycleState}: ${result.status.lastActivity}`);
        return result.status.lifecycleState === "LANDED" ? 0 : 1;
      }
      case "cancel": {
        const result = await cancelCommand({
          attemptDir: located.attemptDir,
          terminal: options.terminal ?? processOwnerTerminal(),
        });
        out(`${result.status.lifecycleState}: survivors [${result.report.survivors.join(", ")}]`);
        return result.status.lifecycleState === "CANCELLED" ? 0 : 1;
      }
      case "retry": {
        const result = await retryCommand({ attemptDir: located.attemptDir, stateRoot });
        out(`Created attempt ${result.status.attempt} in DRAFT with ${result.status.budget.callsSpent} spent call(s) carried.`);
        out(result.status.nextAction);
        return 0;
      }
      default:
        throw new Error(USAGE);
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

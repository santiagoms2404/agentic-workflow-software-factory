import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { stringify as toYaml } from "yaml";
import { buildMinimalConfig } from "../../config/init-template.ts";
import { INIT_OUTPUT_SCHEMA_ID, InitOutputSchema, type InitOutput } from "../../contracts/init-output.ts";
import { systemGitRunner, runGit } from "../../git/changes.ts";
import { commitAsHost } from "../../git/commit.ts";

export interface InitCommandOptions {
  readonly path: string;
  readonly slug: string;
}

export type InitCommandResult = InitOutput;

export class InitTargetNotEmptyError extends Error {
  constructor(path: string) {
    super(`refusing to initialize target because it is not an empty directory: ${path}`);
    this.name = "InitTargetNotEmptyError";
  }
}

/** Creates a repository containing only its minimal configuration and baseline commit. */
export async function initCommand(options: InitCommandOptions): Promise<InitCommandResult> {
  const path = resolve(options.path);
  let exists = true;

  try {
    if ((await readdir(path)).length > 0) throw new InitTargetNotEmptyError(path);
  } catch (error) {
    if (error instanceof InitTargetNotEmptyError) throw error;
    if (hasCode(error, "ENOENT")) exists = false;
    else if (hasCode(error, "ENOTDIR")) throw new InitTargetNotEmptyError(path);
    else throw error;
  }

  if (!exists) await mkdir(path, { recursive: true });

  const runner = systemGitRunner(path);
  runGit(runner, ["init"]);
  await writeFile(join(path, "awsf.config.yaml"), toYaml(buildMinimalConfig(options.slug)), "utf8");
  const commitSha = commitAsHost({ repository: path, message: "chore: awsf init baseline" });
  const line = `Initialized ${path} at ${commitSha}.`;
  const output: InitOutput = {
    schema: INIT_OUTPUT_SCHEMA_ID,
    producerStatus: "success",
    summary: line,
    artifacts: [],
    notesForNextPhase: "",
    kind: "host command result printed to stdout",
    line,
    commitSha,
    path,
  };
  if (!Value.Check(InitOutputSchema, output)) {
    throw new Error("host composed an invalid init envelope");
  }

  return output;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

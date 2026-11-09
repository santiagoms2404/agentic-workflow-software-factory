import type { AuthorizedPublishPlan } from "./authorize.ts";

export const PUBLISH_OUTCOMES = [
  "created",
  "already-current",
  "fast-forwarded",
  "rejected",
  "fault",
] as const;

export type PublishOutcome = (typeof PUBLISH_OUTCOMES)[number];

const FORBIDDEN_PUSH_FLAGS = new Set(["--mirror", "--delete", "--prune", "--force", "-f", "-d"]);

/** Asserts that a push argv contains no destructive or force flags. */
export function validatePublishArgv(argv: readonly string[]): void {
  for (const flag of argv) {
    if (FORBIDDEN_PUSH_FLAGS.has(flag) || flag.startsWith("--force") || (flag.startsWith("-") && flag.includes("f"))) {
      throw new Error(`forbidden push flag in publish argv: ${flag}`);
    }
  }
}

/** Builds the sole publication mutation argv from an authorized plan. */
export function publishArgv(plan: AuthorizedPublishPlan): readonly string[] {
  const argv = ["push", "--porcelain", plan.remoteName, `${plan.sha}:refs/heads/${plan.branch}`];
  validatePublishArgv(argv);
  return argv;
}

function outcomeForFlag(flag: number): PublishOutcome {
  switch (flag) {
    case 42:
      return "created";
    case 61:
      return "already-current";
    case 32:
      return "fast-forwarded";
    case 33:
      return "rejected";
    case 43:
    case 45:
    default:
      return "fault";
  }
}

/** Discards transport framing and maps only tab-separated ref lines. */
export function parsePorcelain(stdout: string): readonly PublishOutcome[] {
  const lines = stdout.split(/\r?\n/u).slice(1);
  while (lines.at(-1) === "") lines.pop();
  if (lines.at(-1) === "Done") lines.pop();

  return lines
    .filter((line) => line.includes("\t"))
    // The first character is read from the untrimmed line because a literal space is meaningful.
    .map((line) => outcomeForFlag(line.charCodeAt(0)));
}

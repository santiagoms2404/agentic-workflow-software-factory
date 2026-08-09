import { TEST_OUTPUT_TAIL_MAX_CHARS, type TestOutput } from "../contracts/test-output.ts";
import { GateReport } from "./interface.ts";

export interface ConfiguredCommand {
  readonly gateId: string;
  readonly argv: readonly string[];
}

export interface CommandGateContext {
  readonly candidateSha: string;
  readonly cleanBefore: boolean;
  readonly cleanAfter: boolean;
}

function sameArgv(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Validates one configured command against host-generated test evidence. */
export function commandsPass(
  output: TestOutput,
  configured: ConfiguredCommand,
  context: CommandGateContext,
): GateReport {
  const report = new GateReport("commands_pass");
  const command = output.commands.find((candidate) => candidate.gateId === configured.gateId);
  report.check("configured gate recorded", command !== undefined, command === undefined ? `missing gateId=${configured.gateId}` : `gateId=${configured.gateId}`);
  report.check("argv exact", command !== undefined && sameArgv(command.argv, configured.argv), `expected argv=${JSON.stringify(configured.argv)}; observed=${JSON.stringify(command?.argv ?? null)}`);
  report.check("candidate SHA exact", output.candidateSha === context.candidateSha, `expected=${context.candidateSha}; observed=${output.candidateSha}`);
  report.check("clean before", context.cleanBefore, context.cleanBefore ? "worktree clean" : "worktree dirty before command");
  report.check("exit code zero", command?.exitCode === 0, command === undefined ? "command absent" : `exitCode=${command.exitCode}`);
  report.check("clean after", context.cleanAfter, context.cleanAfter ? "worktree clean" : "worktree dirty after command");
  report.check(
    "output tail bounded",
    output.outputTail.length <= TEST_OUTPUT_TAIL_MAX_CHARS,
    `tail=${output.outputTail.length} chars; maximum=${TEST_OUTPUT_TAIL_MAX_CHARS}`,
  );
  return report;
}

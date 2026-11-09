import { createInterface } from "node:readline/promises";
import { InteractiveOwnerRequired } from "../state/errors.ts";

export interface OwnerTerminal {
  readonly interactive: boolean;
  write(line: string): void;
  confirm(prompt: string): Promise<boolean>;
}

/**
 * One [y/N] answer read from `input`. Only an explicit yes confirms.
 *
 * End of input (Ctrl-D at the prompt) closes the interface without settling
 * the question, so the question is raced against the close: an owner who
 * leaves the prompt is a refusal, not a process that exits with an unsettled
 * top-level await (B7-34).
 */
export async function readOwnerConfirmation(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  prompt: string,
): Promise<boolean> {
  const readline = createInterface({ input, output });
  const closed = new Promise<string>((resolve) => { readline.once("close", () => resolve("")); });
  try {
    const answer = await Promise.race([readline.question(`${prompt} [y/N] `), closed]);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

/** The real owner channel. Tests inject an OwnerTerminal; production reads this exact TTY. */
export function processOwnerTerminal(): OwnerTerminal {
  return {
    interactive: process.stdin.isTTY === true,
    write(line: string): void {
      process.stdout.write(`${line}\n`);
    },
    async confirm(prompt: string): Promise<boolean> {
      if (!process.stdin.isTTY) {
        throw new InteractiveOwnerRequired("AWAITING_OWNER", "LANDING", "L20", "human");
      }
      return readOwnerConfirmation(process.stdin, process.stdout, prompt);
    },
  };
}

import { createInterface } from "node:readline/promises";
import { InteractiveOwnerRequired } from "../state/errors.ts";

export interface OwnerTerminal {
  readonly interactive: boolean;
  write(line: string): void;
  confirm(prompt: string): Promise<boolean>;
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
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await readline.question(`${prompt} [y/N] `);
        return /^(y|yes)$/i.test(answer.trim());
      } finally {
        readline.close();
      }
    },
  };
}

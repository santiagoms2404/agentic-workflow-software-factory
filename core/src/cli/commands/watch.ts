import { isTerminalStatus, readAttempt } from "./attempt.ts";
import { formatStatus } from "./status.ts";

export interface WatchCommandOptions {
  readonly attemptDir: string;
  readonly pollMs?: number;
  readonly signal?: AbortSignal;
  readonly write: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls the atomic status projection and prints only revisions not yet seen. */
export async function watchCommand(options: WatchCommandOptions): Promise<void> {
  const pollMs = options.pollMs ?? 500;
  let seen = -1;
  while (options.signal?.aborted !== true) {
    const status = await readAttempt(options.attemptDir);
    if (status.revision !== seen) {
      if (seen >= 0) options.write("--- status changed ---");
      for (const line of formatStatus(status)) options.write(line);
      seen = status.revision;
    }
    if (isTerminalStatus(status)) return;
    await (options.sleep ?? delay)(pollMs);
  }
}

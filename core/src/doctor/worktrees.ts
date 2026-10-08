import { isAbsolute, relative, resolve } from "node:path";
import type { DoctorRow } from "../contracts/doctor-readout.ts";

export interface WorktreeFact {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly bare: boolean;
}

/** -z preserves whitespace, newlines and backslashes in paths without Git quoting. */
export function parseWorktrees(text: string): readonly WorktreeFact[] {
  return text.split("\0\0").filter(block => block.length > 0).map(block => {
    const lines = block.split("\0");
    const path = lines.find(line => line.startsWith("worktree "))?.slice(9);
    if (path === undefined) throw new Error("unreadable worktree listing");
    return { path, head: lines.find(line => line.startsWith("HEAD "))?.slice(5) ?? null,
      branch: lines.find(line => line.startsWith("branch refs/heads/"))?.slice(18) ?? null, bare: lines.includes("bare") };
  });
}

export function insideWorktreeRoot(root: string, path: string): boolean {
  const offset = relative(resolve(root), resolve(path));
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(offset));
}

export interface WorktreeCounts {
  readonly total: number;
  readonly underRoot: number;
  readonly terminal: number;
  readonly noAttempt: number;
}

export function worktreesRow(counts: WorktreeCounts | null, root: string, notes: readonly string[] = []): DoctorRow {
  return counts === null ? { status: "warn", detail: [`linked worktrees not measured; factory root=${root}`, ...notes] }
    : { status: counts.terminal > 0 || counts.noAttempt > 0 || notes.length > 0 ? "warn" : "ok",
      detail: [`linked worktrees=${counts.total}; under factory root=${counts.underRoot}; terminal attempt=${counts.terminal}; no attempt=${counts.noAttempt}; factory root=${root}`, ...notes] };
}

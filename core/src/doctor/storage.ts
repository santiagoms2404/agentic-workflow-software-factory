import type { DoctorRow } from "../contracts/doctor-readout.ts";
import { evaluateGitStorage, type StorageMode } from "../preflight/fields.ts";

export interface StorageFacts {
  readonly commonDirectory: string | null;
  readonly worktreeRoot: string;
  readonly stateRoot: string;
  readonly gitEntries: readonly StorageMode[];
  readonly stateEntry: StorageMode;
}

/** Same all-0777 signature as K1; no trial write, chmod, or repair. */
export function storageRow(facts: StorageFacts): DoctorRow {
  const verdict = evaluateGitStorage({ entries: facts.gitEntries });
  const drvfs = facts.gitEntries.length > 0 && facts.gitEntries.every(entry => entry.mode !== null && (entry.mode & 0o777) === 0o777);
  const stateDrvfs = facts.stateEntry.mode !== null && (facts.stateEntry.mode & 0o777) === 0o777;
  return {
    status: drvfs || stateDrvfs ? "finding" : facts.commonDirectory === null || !verdict.passed || facts.stateEntry.mode === null ? "warn" : "ok",
    detail: [
      `Git common directory=${facts.commonDirectory ?? "not measured"}; worktree root=${facts.worktreeRoot}; state root=${facts.stateRoot}`,
      ...[...facts.gitEntries, facts.stateEntry].map(entry => `${entry.path}: mode ${entry.mode === null ? "not measured" : `0${(entry.mode & 0o777).toString(8)}`}`),
      ...(verdict.passed ? [] : [verdict.reason]),
      ...(stateDrvfs ? ["state root reads mode 0777, the DrvFs signature"] : []),
    ],
  };
}

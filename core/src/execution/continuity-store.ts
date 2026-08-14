// The private ledger of provider conversations a phase may re-enter.
//
// Two facts about one conversation live in two different places on purpose, and
// the split is the whole privacy design:
//
//   · the HOST HANDLE (`continuity:<phase>`) is public. It is what
//     `PhaseSession.sessionId` carries, what `assertCorrectionIdentity`
//     compares, and what appears in an error a human reads. It names a
//     conversation without being a locator for it, so a `SessionIdentityBroken`
//     message can say which conversation broke without publishing how to reach
//     it.
//   · the PROVIDER LOCATOR (`providerSessionId`) is private. It lives here, in
//     `private/continuity.json` at mode 0600, reaches the provider on argv, and
//     reaches nothing else — not `status.json`, not the journal's public
//     evidence, not a SQLite DTO, not the API, not a commit message.
//
// The earlier design put the provider locator straight into `PhaseSession`,
// which is what its own doc comment asked for. That was wrong in one specific
// direction: `SessionIdentityBroken` and `CorrectionIdentityMismatch` embed
// those ids in their messages, and a blocked attempt writes that message into
// `status.json` as `blocker.detail`. Privacy that depends on nothing ever
// failing is not privacy.
//
// Nothing here spawns. It reads and writes exactly one host-private file.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { ContinuityRef } from "../adapters/interface.ts";

const { chmod, mkdir, readFile, writeFile } = fs;

export const CONTINUITY_SCHEMA = "awsf.continuity/v1";

/** Mode 0700. A directory a group could list is a directory a group could read. */
export const CONTINUITY_DIR_MODE = 0o700;
export const CONTINUITY_FILE_MODE = 0o600;

/**
 * One phase's conversation.
 *
 * `turns` counts sends, so `turns === 1` is a phase that has answered once and
 * has something to correct. It is the host's own count rather than a number
 * read back from the provider's store: the adapter proves the store agrees, and
 * two independent counts that must match are worth more than one that cannot be
 * checked.
 */
export interface ContinuityRecord {
  readonly handle: string;
  readonly phaseId: string;
  readonly adapter: string;
  readonly provider: string;
  /** The model as the route resolved it. A correction that answers on another model is terminal. */
  readonly model: string;
  readonly providerSessionId: string;
  readonly storeDir: string | null;
  readonly openedAt: string;
  readonly turns: number;
}

interface ContinuityFile {
  readonly schema: typeof CONTINUITY_SCHEMA;
  readonly records: Readonly<Record<string, ContinuityRecord>>;
}

/**
 * The public name of a phase's conversation.
 *
 * Derived from the phase id alone, because a phase has exactly one conversation
 * and a handle that also encoded the run id would change under a retry that is
 * supposed to be a different conversation anyway. Deterministic, so a replayed
 * journal produces the same string.
 */
export function continuityHandle(phaseId: string): string {
  return `continuity:${phaseId}`;
}

export class ContinuityUnavailable extends Error {
  readonly handle: string;

  constructor(handle: string, detail: string) {
    super(`continuity ${handle} is unusable: ${detail}`);
    this.name = "ContinuityUnavailable";
    this.handle = handle;
  }
}

export interface ContinuityStoreOptions {
  /** `private/continuity.json` for this attempt. */
  readonly path: string;
  /**
   * Mints a provider session id. Injected only so a test can pin one; the
   * default is a v4 UUID, which is the intersection of what Claude Code accepts
   * (UUID only) and what pi accepts (alphanumeric plus `. _ -`).
   */
  readonly newSessionId?: () => string;
  readonly now?: () => string;
}

/**
 * Host-private, in-memory with a durable mirror.
 *
 * Writes are whole-file and atomic through `writeFile` + `chmod`, because the
 * file is small, single-writer, and read only by a host that already holds the
 * attempt lock. The mode is re-applied after every write rather than trusted to
 * survive a umask.
 */
export class ContinuityStore {
  readonly #path: string;
  readonly #newSessionId: () => string;
  readonly #now: () => string;
  readonly #records = new Map<string, ContinuityRecord>();

  constructor(options: ContinuityStoreOptions) {
    this.#path = options.path;
    this.#newSessionId = options.newSessionId ?? randomUUID;
    this.#now = options.now ?? ((): string => new Date().toISOString());
  }

  /** Rehydrates from disk. A missing or unreadable file is an empty store, never a throw. */
  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.#path, "utf8");
    } catch {
      return;
    }
    let parsed: Partial<ContinuityFile>;
    try {
      parsed = JSON.parse(text) as Partial<ContinuityFile>;
    } catch {
      return;
    }
    if (parsed.schema !== CONTINUITY_SCHEMA || typeof parsed.records !== "object" || parsed.records === null) {
      return;
    }
    for (const [handle, record] of Object.entries(parsed.records)) {
      this.#records.set(handle, record);
    }
  }

  get(handle: string): ContinuityRecord | undefined {
    return this.#records.get(handle);
  }

  /**
   * Every locator this attempt has minted, for the one caller that legitimately
   * needs the whole set: the redactor that keeps them out of `command_json`.
   *
   * The locator reaches the provider on argv — that IS the protocol — and argv
   * is recorded verbatim in the durable process row. Without this, "the locator
   * never reaches the journal" would be false the moment the feature worked.
   */
  locators(): readonly string[] {
    return Object.freeze([...this.#records.values()].map((record) => record.providerSessionId));
  }

  ref(handle: string): ContinuityRef {
    const record = this.#records.get(handle);
    if (record === undefined) throw new ContinuityUnavailable(handle, "no conversation was opened under this handle");
    return Object.freeze({ providerSessionId: record.providerSessionId, storeDir: record.storeDir });
  }

  /**
   * Opens a conversation for a phase. Mints the locator; creates no session —
   * the provider does that on its first turn, under the id it is handed.
   *
   * Refuses a second open on the same handle. A phase that opened twice would
   * have two conversations and one handle, and every later identity check would
   * be comparing against whichever won.
   */
  async open(input: {
    phaseId: string;
    adapter: string;
    provider: string;
    model: string;
    storeDir: string | null;
  }): Promise<ContinuityRecord> {
    const handle = continuityHandle(input.phaseId);
    if (this.#records.has(handle)) {
      throw new ContinuityUnavailable(handle, "a conversation is already open under this handle");
    }
    const record: ContinuityRecord = Object.freeze({
      handle,
      phaseId: input.phaseId,
      adapter: input.adapter,
      provider: input.provider,
      model: input.model,
      providerSessionId: this.#newSessionId(),
      storeDir: input.storeDir,
      openedAt: this.#now(),
      turns: 0,
    });
    this.#records.set(handle, record);
    await this.#flush();
    return record;
  }

  /** Records that a turn completed. The count is what `assertCorrectable` reads. */
  async recordTurn(handle: string): Promise<ContinuityRecord> {
    const record = this.#records.get(handle);
    if (record === undefined) throw new ContinuityUnavailable(handle, "no conversation was opened under this handle");
    const next: ContinuityRecord = Object.freeze({ ...record, turns: record.turns + 1 });
    this.#records.set(handle, next);
    await this.#flush();
    return next;
  }

  /**
   * Everything the host can check about a correction WITHOUT launching
   * anything: the conversation exists, it has answered at least once, and the
   * route it is about to be re-entered on is the exact route it was opened on.
   *
   * The adapter's own `assertResumable` is the other half and runs after this.
   * Splitting them is deliberate — this half is provider-neutral and holds for
   * every route, including one whose CLI cannot be interrogated at all.
   */
  assertCorrectable(handle: string, route: { adapter: string; provider: string; model: string }): ContinuityRecord {
    const record = this.#records.get(handle);
    if (record === undefined) throw new ContinuityUnavailable(handle, "no conversation was opened under this handle");
    if (record.turns < 1) {
      throw new ContinuityUnavailable(handle, "the conversation has no completed turn to correct");
    }
    const differences = (["adapter", "provider", "model"] as const)
      .filter((field) => record[field] !== route[field])
      .map((field) => `${field} ${JSON.stringify(record[field])} became ${JSON.stringify(route[field])}`);
    if (differences.length > 0) {
      throw new ContinuityUnavailable(handle, `the route changed: ${differences.join("; ")}`);
    }
    return record;
  }

  async #flush(): Promise<void> {
    const file: ContinuityFile = {
      schema: CONTINUITY_SCHEMA,
      records: Object.fromEntries(this.#records),
    };
    await mkdir(dirname(this.#path), { recursive: true, mode: CONTINUITY_DIR_MODE });
    await writeFile(this.#path, JSON.stringify(file), { mode: CONTINUITY_FILE_MODE });
    await chmod(this.#path, CONTINUITY_FILE_MODE);
  }
}

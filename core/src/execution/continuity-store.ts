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
import { constants, promises as fs } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { ContinuityRef } from "../adapters/interface.ts";
import { canonicalJson, sha256 } from "../contracts/owner-amendment.ts";
import {
  InterruptedTurnRefused, assertTurnCheckpoint, continuityDigest,
  type InterruptedTurnCheckpoint, type TurnCheckpointReference,
} from "../contracts/interrupted-turn.ts";

const { readFile } = fs;

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
 * Writes sync a private temporary file, atomically replace the mirror, then
 * sync its directory. The host must still hold the operation lock. The mirror
 * records conversations only and cannot authorize an interrupted-turn rescue.
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
    return Object.freeze([...this.#records.values()].flatMap((record) =>
      record.storeDir === null ? [record.providerSessionId] : [record.providerSessionId, record.storeDir]));
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
    await writePrivateAtomic(this.#path, JSON.stringify(file));
  }
}

const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;

function privateFailure(): never {
  throw new InterruptedTurnRefused("checkpoint-invalid", "private checkpoint storage is missing, unsafe, or inconsistent");
}

function ownerUid(): number {
  if (typeof process.getuid !== "function") {
    throw new InterruptedTurnRefused("proof-unavailable", "private checkpoint ownership verification is unavailable on this platform");
  }
  return process.getuid();
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Reject aliases before creating any missing private directory. */
async function privateDirectory(path: string, create: boolean): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path) return privateFailure();
  const uid = ownerUid();
  const root = parse(path).root;
  let current = root;
  for (const component of path.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    const parent = current;
    current = join(current, component);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") return privateFailure();
      try { await fs.mkdir(current, { mode: CONTINUITY_DIR_MODE }); }
      catch (creation) { if ((creation as NodeJS.ErrnoException).code !== "EEXIST") return privateFailure(); }
      stat = await fs.lstat(current);
      await syncDirectory(parent);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return privateFailure();
  }
  const stat = await fs.lstat(path);
  if (stat.uid !== uid || (stat.mode & 0o777) !== CONTINUITY_DIR_MODE) return privateFailure();
}

async function privateBytes(path: string): Promise<string> {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== ownerUid() || (stat.mode & 0o777) !== CONTINUITY_FILE_MODE || stat.size > MAX_CHECKPOINT_BYTES) return privateFailure();
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}

async function writePrivateExclusive(path: string, text: string): Promise<void> {
  if (Buffer.byteLength(text, "utf8") > MAX_CHECKPOINT_BYTES) return privateFailure();
  const handle = await fs.open(path, "wx", CONTINUITY_FILE_MODE);
  try {
    await handle.chmod(CONTINUITY_FILE_MODE);
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}

async function writePrivateAtomic(path: string, text: string): Promise<void> {
  const directory = dirname(path);
  await privateDirectory(directory, true);
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== ownerUid() || (stat.mode & 0o777) !== CONTINUITY_FILE_MODE) return privateFailure();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(directory, `.continuity-${randomUUID()}.tmp`);
  await writePrivateExclusive(temporary, text);
  await fs.rename(temporary, path);
  await syncDirectory(directory);
}

function originalBinding(checkpoint: InterruptedTurnCheckpoint): string {
  const { effectiveInputDigest: _effective, ownerAmendmentDigest: _amendment, ...original } = checkpoint.binding;
  return continuityDigest(original);
}

/**
 * Immutable generations. The caller fsyncs these bytes BEFORE appending their
 * reference to the attempt journal under its operation lock. Neither orphan
 * bytes nor latest.json grant authority. Reads require the journal's exact ref.
 */
export class InterruptedTurnStore {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root) || resolve(root) !== root) privateFailure();
    this.#root = root;
  }

  #directory(logicalTurnId: string): string {
    return join(this.#root, sha256(logicalTurnId));
  }

  async read(reference: TurnCheckpointReference): Promise<InterruptedTurnCheckpoint> {
    try {
      if (reference.schema !== "awsf.turn-checkpoint-ref/v1" || !Number.isSafeInteger(reference.generation) || reference.generation < 1 ||
          !/^[a-f0-9]{64}$/.test(reference.digest) || !/^[a-f0-9]{64}$/.test(reference.bindingDigest) || typeof reference.logicalTurnId !== "string") return privateFailure();
      const directory = this.#directory(reference.logicalTurnId);
      await privateDirectory(this.#root, false);
      await privateDirectory(directory, false);
      const text = await privateBytes(join(directory, `${reference.generation}.json`));
      const checkpoint: unknown = JSON.parse(text);
      assertTurnCheckpoint(checkpoint);
      if (sha256(text) !== reference.digest || continuityDigest(checkpoint.binding) !== reference.bindingDigest ||
          checkpoint.binding.logicalTurnId !== reference.logicalTurnId || checkpoint.generation !== reference.generation) return privateFailure();
      return checkpoint;
    } catch (error) {
      if (error instanceof InterruptedTurnRefused) throw error;
      return privateFailure();
    }
  }

  async write(input: InterruptedTurnCheckpoint, previous: TurnCheckpointReference | null): Promise<TurnCheckpointReference> {
    const checkpoint = structuredClone(input);
    assertTurnCheckpoint(checkpoint);
    if (previous === null) {
      if (checkpoint.generation !== 1 || checkpoint.priorDigest !== null) return privateFailure();
    } else {
      const prior = await this.read(previous);
      if (prior.completed) throw new InterruptedTurnRefused("turn-already-completed", "a completed logical turn cannot acquire another checkpoint");
      if (checkpoint.generation !== prior.generation + 1 || checkpoint.priorDigest !== previous.digest ||
          originalBinding(checkpoint) !== originalBinding(prior) || checkpoint.continuityHandle !== prior.continuityHandle ||
          !checkpoint.output.text.startsWith(prior.output.text) || checkpoint.output.nextSequence < prior.output.nextSequence) return privateFailure();
      for (const field of ["conversationId", "requestId", "checkpointLineage"] as const) {
        if (prior.providerIdentity[field] !== null && checkpoint.providerIdentity[field] !== prior.providerIdentity[field]) return privateFailure();
      }
      const acceptanceOrder = ["not-sent", "unknown", "accepted", "completed"];
      if (acceptanceOrder.indexOf(checkpoint.providerIdentity.acceptance) < acceptanceOrder.indexOf(prior.providerIdentity.acceptance)) return privateFailure();
      for (const tool of prior.tools) {
        const next = checkpoint.tools.find((entry) => entry.providerToolCallId === tool.providerToolCallId);
        if (next === undefined || next.executionKey !== tool.executionKey || next.name !== tool.name) return privateFailure();
        if (tool.state !== "arguments-partial" && next.argumentsDigest !== tool.argumentsDigest) return privateFailure();
        if (tool.state === "arguments-partial" && !next.argumentsJson.startsWith(tool.argumentsJson)) return privateFailure();
        const order = ["arguments-partial", "ready", "dispatch-intent", "result-durable", "acknowledged"];
        if (order.indexOf(next.state) < order.indexOf(tool.state)) return privateFailure();
        if (tool.resultDigest !== null && next.resultDigest !== tool.resultDigest) return privateFailure();
      }
      for (const mapping of prior.output.toolIdMap) {
        if (!checkpoint.output.toolIdMap.some((entry) => entry.providerId === mapping.providerId && entry.hostId === mapping.hostId)) return privateFailure();
      }
    }
    const text = canonicalJson(checkpoint);
    const reference: TurnCheckpointReference = Object.freeze({ schema: "awsf.turn-checkpoint-ref/v1",
      logicalTurnId: checkpoint.binding.logicalTurnId, generation: checkpoint.generation,
      digest: sha256(text), bindingDigest: continuityDigest(checkpoint.binding) });
    try {
      const directory = this.#directory(checkpoint.binding.logicalTurnId);
      await privateDirectory(this.#root, true);
      await privateDirectory(directory, true);
      const path = join(directory, `${checkpoint.generation}.json`);
      try { await writePrivateExclusive(path, text); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // Idempotent byte-identical persistence only. Never rewrite a generation
        // and never let an old retry move a newer disposable mirror backwards.
        await this.read(reference);
        return reference;
      }
      await writePrivateAtomic(join(directory, "latest.json"), canonicalJson(reference));
      return reference;
    } catch (error) {
      if (error instanceof InterruptedTurnRefused) throw error;
      return privateFailure();
    }
  }
}

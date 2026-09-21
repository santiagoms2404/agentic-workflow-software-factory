import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { recoveryDigest } from "./phase-recovery.ts";

const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const oid = Type.String({ pattern: "^[a-f0-9]{40}$" });
const id = Type.String({ minLength: 1, maxLength: 256 });
const text = Type.String({ minLength: 1, maxLength: 16384 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const fileMode = Type.Union([Type.Literal("100644"), Type.Literal("100755")]);
const nullableOid = Type.Union([oid, Type.Null()]);
const nullableMode = Type.Union([fileMode, Type.Null()]);

export const ProtectedFilesystemIdentitySchema = Type.Object({
  path,
  device: Type.String({ pattern: "^[0-9]+$" }),
  inode: Type.String({ pattern: "^[0-9]+$" }),
  uid: Type.Integer({ minimum: 0 }),
  gid: Type.Integer({ minimum: 0 }),
  mode: Type.Integer({ minimum: 0, maximum: 4095 }),
}, { additionalProperties: false });
export type ProtectedFilesystemIdentity = Static<typeof ProtectedFilesystemIdentitySchema>;

export const ProtectedFileBaselineSchema = Type.Object({
  path,
  blob: nullableOid,
  mode: nullableMode,
  /** Physical directories from the worktree root through the nearest existing parent. */
  parents: Type.Array(ProtectedFilesystemIdentitySchema, { minItems: 1, maxItems: 256 }),
  file: Type.Union([ProtectedFilesystemIdentitySchema, Type.Null()]),
}, { additionalProperties: false });
export type ProtectedFileBaseline = Static<typeof ProtectedFileBaselineSchema>;

export const ProtectedGrantSubjectSchema = Type.Object({
  project: id, taskId: id, sessionId: id, attempt: Type.Integer({ minimum: 1 }),
  repository: path, commonGitDir: path, worktree: path, worktreeGitDir: path,
  roots: Type.Array(ProtectedFilesystemIdentitySchema, { minItems: 4, maxItems: 4 }),
  integrationBaseSha: oid, preWriteHeadSha: oid,
  phaseKey: id, phaseOrdinal: Type.Integer({ minimum: 1 }),
  /** Hash of immutable request/config/recipe/route/runtime bindings, excluding grant events. */
  bindingDigest: digest,
}, { additionalProperties: false });
export type ProtectedGrantSubject = Static<typeof ProtectedGrantSubjectSchema>;

export const ProtectedGrantSchema = Type.Object({
  schema: Type.Literal("awsf.protected-grant/v1"),
  id, generationId: id, subject: ProtectedGrantSubjectSchema,
  files: Type.Array(ProtectedFileBaselineSchema, { minItems: 1, maxItems: 64 }),
  anchorRevision: Type.Integer({ minimum: 1 }),
  reason: text, confirmedAt: text, digest,
}, { additionalProperties: false });
export type ProtectedGrant = Static<typeof ProtectedGrantSchema>;

/** Embedded in the ordinary phase/owner resume activation, never persisted on its own. */
export const ProtectedGrantConsumptionSchema = Type.Object({
  id, grantId: id, grantDigest: digest, generationId: id,
  operationId: id, reservationId: id,
  phaseKey: id, phaseOrdinal: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type ProtectedGrantConsumption = Static<typeof ProtectedGrantConsumptionSchema>;

export const ProtectedBlobDeltaSchema = Type.Object({
  path, beforeBlob: nullableOid, beforeMode: nullableMode,
  afterBlob: oid, afterMode: fileMode,
}, { additionalProperties: false });
export type ProtectedBlobDelta = Static<typeof ProtectedBlobDeltaSchema>;

/** A3 must reconcile this exact parent/tree/commit tuple, never replay commit creation. */
export const ProtectedCandidateBindingSchema = Type.Object({
  schema: Type.Literal("awsf.protected-candidate-binding/v1"),
  id, grantId: id, grantDigest: digest, consumptionId: id, generationId: id,
  operationId: id, phaseKey: id, phaseOrdinal: Type.Integer({ minimum: 1 }),
  parentSha: oid, treeSha: oid, candidateSha: oid,
  deltas: Type.Array(ProtectedBlobDeltaSchema, { maxItems: 64 }),
  sandboxBadge: Type.Literal("os-enforced"),
  createdAt: text, digest,
}, { additionalProperties: false });
export type ProtectedCandidateBinding = Static<typeof ProtectedCandidateBindingSchema>;

export const ProtectedCandidateAuthorizationSchema = Type.Object({
  schema: Type.Literal("awsf.protected-candidate-authorization/v1"),
  id, sessionId: id, attempt: Type.Integer({ minimum: 1 }),
  candidateSha: oid, integrationBaseSha: oid,
  bindingChainDigest: digest, protectedDeltaDigest: digest,
  confirmedAt: text, digest,
}, { additionalProperties: false });
export type ProtectedCandidateAuthorization = Static<typeof ProtectedCandidateAuthorizationSchema>;

export function protectedFactDigest(value: { readonly digest: string }): string {
  const { digest: _digest, ...content } = value;
  return recoveryDigest(content);
}

export function assertProtectedCandidateAuthorization(value: unknown, expected: {
  readonly sessionId: string; readonly attempt: number; readonly candidateSha: string;
  readonly integrationBaseSha: string; readonly bindingChainDigest: string; readonly protectedDeltaDigest: string;
}): asserts value is ProtectedCandidateAuthorization {
  if (!Value.Check(ProtectedCandidateAuthorizationSchema, value) || protectedFactDigest(value) !== value.digest ||
      value.sessionId !== expected.sessionId || value.attempt !== expected.attempt || value.candidateSha !== expected.candidateSha ||
      value.integrationBaseSha !== expected.integrationBaseSha || value.bindingChainDigest !== expected.bindingChainDigest ||
      value.protectedDeltaDigest !== expected.protectedDeltaDigest) throw new Error("protected candidate authorization mismatch");
}

export function assertExactProtectedPath(value: string): void {
  if (value !== value.normalize("NFC") || value.length === 0 || value.length > 4096 ||
      [...value].some(character => character.codePointAt(0)! <= 31 || character.codePointAt(0) === 127 || "\\:*?[]{}!".includes(character)) || value.startsWith("/") ||
      value.split("/").some(segment => segment === "" || segment === "." || segment === ".." || segment.toLowerCase() === ".git" ||
        /[. ]$/u.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) {
    throw new Error("protected grant requires an exact normalized repository-relative file path");
  }
}

function assertUniquePaths(values: readonly { path: string }[]): void {
  const folded = new Set<string>();
  for (const entry of values) {
    assertExactProtectedPath(entry.path);
    const key = entry.path.toLowerCase();
    if (folded.has(key)) throw new Error("protected grant paths contain a duplicate or case alias");
    folded.add(key);
  }
}

export function assertProtectedGrant(value: unknown): asserts value is ProtectedGrant {
  if (!Value.Check(ProtectedGrantSchema, value)) throw new Error("invalid protected grant schema");
  if (protectedFactDigest(value) !== value.digest) throw new Error("protected grant digest mismatch");
  assertUniquePaths(value.files);
  for (const file of value.files) {
    if ((file.blob === null) !== (file.mode === null) || (file.file === null) !== (file.blob === null)) {
      throw new Error("protected grant file baseline is inconsistent");
    }
    if (file.file !== null && file.file.path !== file.path) throw new Error("protected grant file identity changed path");
    if (file.parents[0]!.path !== value.subject.worktree) throw new Error("protected grant parent chain has another root");
  }
}

export function assertProtectedConsumption(value: unknown, grant: ProtectedGrant): asserts value is ProtectedGrantConsumption {
  assertProtectedGrant(grant);
  if (!Value.Check(ProtectedGrantConsumptionSchema, value) || value.grantId !== grant.id || value.grantDigest !== grant.digest ||
      value.generationId !== grant.generationId || value.phaseKey !== grant.subject.phaseKey || value.phaseOrdinal !== grant.subject.phaseOrdinal) {
    throw new Error("protected grant consumption binding mismatch");
  }
}

export function assertProtectedCandidateBinding(value: unknown, grant: ProtectedGrant, consumption: ProtectedGrantConsumption): asserts value is ProtectedCandidateBinding {
  assertProtectedConsumption(consumption, grant);
  if (!Value.Check(ProtectedCandidateBindingSchema, value) || protectedFactDigest(value) !== value.digest ||
      value.grantId !== grant.id || value.grantDigest !== grant.digest || value.consumptionId !== consumption.id ||
      value.generationId !== grant.generationId || value.operationId !== consumption.operationId ||
      value.phaseKey !== grant.subject.phaseKey || value.phaseOrdinal !== grant.subject.phaseOrdinal ||
      value.parentSha !== grant.subject.preWriteHeadSha || value.candidateSha === value.parentSha) {
    throw new Error("protected candidate binding mismatch");
  }
  assertUniquePaths(value.deltas);
  for (const delta of value.deltas) {
    const baseline = grant.files.find(file => file.path === delta.path);
    if (baseline === undefined || delta.beforeBlob !== baseline.blob || delta.beforeMode !== baseline.mode ||
        delta.afterMode !== (baseline.mode ?? "100644") || delta.afterBlob === delta.beforeBlob) {
      throw new Error("protected candidate delta exceeds its content-only grant");
    }
  }
}

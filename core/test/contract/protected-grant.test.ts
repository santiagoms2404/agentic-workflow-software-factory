import assert from "node:assert/strict";
import { test } from "node:test";
import { assertExactProtectedPath, assertProtectedCandidateAuthorization, assertProtectedCandidateBinding, assertProtectedConsumption, assertProtectedGrant,
  protectedFactDigest, type ProtectedGrant, type ProtectedGrantConsumption, type ProtectedCandidateBinding } from "../../src/contracts/protected-grant.ts";

const oid = (digit: string) => digit.repeat(40);
const hash = (digit: string) => digit.repeat(64);
function sign<T extends { digest: string }>(value: T): T { return { ...value, digest: protectedFactDigest(value) }; }
function grant(): ProtectedGrant {
  return sign({ schema: "awsf.protected-grant/v1", id: "grant-one", generationId: "generation-one",
    subject: { project: "fixture", taskId: "bounded-edit", sessionId: "session-one", attempt: 1,
      repository: "/fixture/repository", worktree: "/fixture/worktree", commonGitDir: "/fixture/repository/.git",
      integrationBaseSha: oid("1"), preWriteHeadSha: oid("2"), phaseKey: "builder", phaseOrdinal: 2, bindingDigest: hash("3") },
    files: [{ path: "core/src/policy/example.ts", blob: oid("4"), mode: "100644",
      parents: [{ path: "/fixture/worktree", device: "1", inode: "2", uid: 1000, gid: 1000, mode: 0o755 }],
      file: { path: "core/src/policy/example.ts", device: "1", inode: "3", uid: 1000, gid: 1000, mode: 0o644 } }],
    anchorRevision: 4, reason: "Change only the explicitly named policy source.", confirmedAt: "2026-09-20T00:00:00Z", digest: "" });
}
function consumption(g: ProtectedGrant): ProtectedGrantConsumption {
  return { id: "activation-one", grantId: g.id, grantDigest: g.digest, generationId: g.generationId,
    operationId: "operation-one", reservationId: "operation-one:call:1", phaseKey: g.subject.phaseKey, phaseOrdinal: g.subject.phaseOrdinal };
}
function binding(g: ProtectedGrant, c: ProtectedGrantConsumption): ProtectedCandidateBinding {
  return sign({ schema: "awsf.protected-candidate-binding/v1", id: "binding-one", grantId: g.id, grantDigest: g.digest,
    consumptionId: c.id, generationId: g.generationId, operationId: c.operationId, phaseKey: c.phaseKey, phaseOrdinal: c.phaseOrdinal,
    parentSha: g.subject.preWriteHeadSha, treeSha: oid("5"), candidateSha: oid("6"),
    deltas: [{ path: g.files[0]!.path, beforeBlob: oid("4"), beforeMode: "100644", afterBlob: oid("7"), afterMode: "100644" }],
    sandboxBadge: "os-enforced", createdAt: "2026-09-20T00:01:00Z", digest: "" });
}

test("protected-grant contracts bind issuance, consumption and the produced candidate separately", () => {
  const g = grant(); const c = consumption(g); const b = binding(g, c);
  assertProtectedGrant(JSON.parse(JSON.stringify(g)));
  assertProtectedConsumption(c, g);
  assertProtectedCandidateBinding(b, g, c);
  assert.equal("candidateSha" in g, false, "issuance never authorizes an unborn candidate");
  assert.throws(() => assertProtectedGrant({ ...g, candidateSha: b.candidateSha }), /schema/);
});

for (const path of ["", "/absolute.ts", "../escape.ts", "a/../b.ts", "a//b.ts", "a/./b.ts", "a\\b.ts", "a/*", "a/?.ts", "a/[x]", "a/{x}", "a/!x", ".git/config", "a/.GIT/config", "C:/file.ts", "a/name:stream", "a/name.", "a/name ", "a/CON.ts", "a/LPT1", "a/cafe\u0301.ts", "a/line\n.ts"]) {
  test(`exact protected path refuses ${JSON.stringify(path)}`, () => assert.throws(() => assertExactProtectedPath(path), /exact normalized/));
}
test("exact protected path accepts normalized Unicode and literal internal spaces", () => {
  assertExactProtectedPath("core/src/café file.ts");
});

for (const field of ["id", "generationId", "reason", "anchorRevision", "subject", "files"] as const) {
  test(`protected issuance digest detects changed ${field}`, () => {
    const changed: Record<string, unknown> = structuredClone(grant());
    changed[field] = field === "anchorRevision" ? 5 : field === "subject" ? { ...grant().subject, phaseOrdinal: 3 }
      : field === "files" ? [] : "changed";
    assert.throws(() => assertProtectedGrant(changed));
  });
}

test("protected issuance refuses duplicate/case-aliased paths and inconsistent physical baseline", () => {
  const g = grant();
  assert.throws(() => assertProtectedGrant(sign({ ...g, files: [...g.files, { ...g.files[0]!, path: "CORE/src/policy/example.ts" }] })), /duplicate or case alias/);
  assert.throws(() => assertProtectedGrant(sign({ ...g, files: [{ ...g.files[0]!, blob: null }] })), /inconsistent/);
  assert.throws(() => assertProtectedGrant(sign({ ...g, files: [{ ...g.files[0]!, parents: [{ ...g.files[0]!.parents[0]!, path: "/another/root" }] }] })), /another root/);
});

for (const field of ["grantId", "grantDigest", "generationId", "phaseKey", "phaseOrdinal"] as const) {
  test(`protected activation refuses changed ${field}`, () => {
    const g = grant(); const c = consumption(g);
    assert.throws(() => assertProtectedConsumption({ ...c, [field]: field === "phaseOrdinal" ? 3 : field === "grantDigest" ? hash("9") : "changed" }, g), /binding mismatch/);
  });
}

for (const field of ["grantId", "grantDigest", "consumptionId", "generationId", "operationId", "phaseKey", "phaseOrdinal", "parentSha", "sandboxBadge"] as const) {
  test(`protected candidate refuses re-signed changed ${field}`, () => {
    const g = grant(); const c = consumption(g); const b = binding(g, c);
    const changed = sign({ ...b, [field]: field === "phaseOrdinal" ? 3 : field === "grantDigest" ? hash("9")
      : field === "parentSha" ? oid("9") : field === "sandboxBadge" ? "tool-policy" : "changed" });
    assert.throws(() => assertProtectedCandidateBinding(changed, g, c), /binding mismatch/);
  });
}

for (const mutation of ["ungranted", "case-alias", "mode", "before-blob", "unchanged", "deletion"] as const) {
  test(`protected candidate rejects ${mutation} despite a valid content digest`, () => {
    const g = grant(); const c = consumption(g); const b = binding(g, c); const delta = b.deltas[0]!;
    const altered = { ...delta, ...(mutation === "ungranted" ? { path: "core/src/policy/other.ts" }
      : mutation === "case-alias" ? { path: delta.path.toUpperCase() } : mutation === "mode" ? { afterMode: "100755" }
      : mutation === "before-blob" ? { beforeBlob: oid("9") } : mutation === "unchanged" ? { afterBlob: delta.beforeBlob }
      : { afterBlob: null, afterMode: null }) };
    assert.throws(() => assertProtectedCandidateBinding(sign({ ...b, deltas: [altered] }), g, c));
  });
}

test("final protected approval binds exact target, candidate, delta and chain", () => {
  const expected = { sessionId: "session-one", attempt: 1, candidateSha: oid("6"), integrationBaseSha: oid("1"),
    bindingChainDigest: hash("8"), protectedDeltaDigest: hash("9") };
  const authorization = sign({ schema: "awsf.protected-candidate-authorization/v1", id: "final-one", ...expected,
    confirmedAt: "2026-09-20T00:02:00Z", digest: "" });
  assertProtectedCandidateAuthorization(authorization, expected);
  assert.throws(() => assertProtectedCandidateAuthorization({ protectedApprovalsValid: true }, expected));
  for (const [key, value] of Object.entries(expected)) {
    const changed = { ...expected, [key]: typeof value === "number" ? value + 1 : value.length === 40 ? oid("0") : value.length === 64 ? hash("0") : "another-session" };
    assert.throws(() => assertProtectedCandidateAuthorization(authorization, changed), /authorization mismatch/);
  }
});

test("an unused exception can bind a commit with no protected delta without granting any additional path", () => {
  const g = grant(); const c = consumption(g); const b = binding(g, c);
  assertProtectedCandidateBinding(sign({ ...b, deltas: [] }), g, c);
});

test("protected candidate permits new non-executable regular content only", () => {
  const old = grant(); const g = sign({ ...old, files: [{ ...old.files[0]!, blob: null, mode: null, file: null }] });
  const c = consumption(g); const original = binding(g, c);
  const b = sign({ ...original, deltas: [{ ...original.deltas[0]!, beforeBlob: null, beforeMode: null }] });
  assertProtectedCandidateBinding(b, g, c);
  assert.throws(() => assertProtectedCandidateBinding(sign({ ...b, deltas: [{ ...b.deltas[0]!, afterMode: "100755" }] }), g, c));
});

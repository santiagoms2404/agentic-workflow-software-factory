import type { ProtectedGrant, ProtectedGrantConsumption, ProtectedGrantSubject } from "./protected-grant.ts";

declare const capabilityBrand: unique symbol;
export interface ProtectedFilesCapability { readonly [capabilityBrand]: true }
export interface ProtectedPermissionBinding {
  readonly profile: string; readonly tools: readonly string[]; readonly writes: readonly string[]; readonly protectedPaths: readonly string[];
}
interface Authority {
  readonly kind: "write" | "preserve";
  readonly paths: readonly string[];
  readonly grant?: ProtectedGrant;
  readonly consumption?: ProtectedGrantConsumption;
  readonly policy?: ProtectedPermissionBinding;
}
const issued = new WeakMap<object, Authority>();
function mint(authority: Authority): ProtectedFilesCapability {
  const capability = Object.freeze(Object.create(null)) as ProtectedFilesCapability;
  issued.set(capability, authority);
  return capability;
}
function authority(value: unknown): Authority | undefined {
  return typeof value === "object" && value !== null ? issued.get(value) : undefined;
}
export function isProtectedCapability(value: unknown): boolean { return authority(value) !== undefined; }
/** Pure exact membership. JSON, structural types, Sets and copied objects have no authority. */
export function protectedExemptionAllows(value: unknown, path: string, purpose: "write" | "gate" = "gate"): boolean {
  const proof = authority(value);
  return proof !== undefined && (purpose === "gate" || proof.kind === "write") && proof.paths.includes(path);
}
export function protectedWriteContext(value: unknown): { grant: ProtectedGrant; consumption: ProtectedGrantConsumption; policy: ProtectedPermissionBinding } | null {
  const proof = authority(value);
  return proof?.kind === "write" && proof.grant !== undefined && proof.consumption !== undefined && proof.policy !== undefined
    ? { grant: proof.grant, consumption: proof.consumption, policy: proof.policy } : null;
}
/** Only host verification can reach the private mint. No public data-to-capability constructor exists. */
export async function verifyProtectedWrite(input: { attemptDir: string; subject: ProtectedGrantSubject; operationId: string; reservationId: string }): Promise<ProtectedFilesCapability> {
  const host = await import("../workflow/protected-grants.ts");
  const proof = await host.verifyConsumedProtectedGrant(input);
  return mint(Object.freeze({ kind: "write", paths: Object.freeze(proof.grant.files.map(file => file.path)), ...proof }));
}
export async function verifyProtectedPreservation(attemptDir: string, candidateSha: string, writing?: ProtectedFilesCapability): Promise<ProtectedFilesCapability> {
  const host = await import("../workflow/protected-grants.ts");
  const active = protectedWriteContext(writing);
  const proof = host.inspectProtectedCandidate(attemptDir, candidateSha, active?.consumption.id);
  if (active !== null && (active.grant.subject.worktree !== proof.state.status.worktree || active.grant.subject.preWriteHeadSha !== candidateSha)) throw new Error("protected preservation cannot borrow another write scope");
  host.assertProtectedPreservedBytes(proof, active?.grant.files.map(file => file.path) ?? []);
  return mint(Object.freeze({ kind: "preserve", paths: Object.freeze(proof.deltas.map(delta => delta.path)) }));
}

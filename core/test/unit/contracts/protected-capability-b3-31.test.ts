// B3-31 — the write capability's kind and paths come from the grant.
//
// verifyProtectedWrite spread the verifier's result after `kind` and `paths`,
// so a key the verifier returned would have replaced the write capability's own
// path set. The capability is now minted by a pure helper that sets both after
// the verifier's fields, so no returned key can override them.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mintWriteCapability,
  protectedExemptionAllows,
  protectedWriteContext,
  type ProtectedPermissionBinding,
} from "../../../src/contracts/protected-capability.ts";
import type { ProtectedGrant, ProtectedGrantConsumption } from "../../../src/contracts/protected-grant.ts";

const grant = { id: "grant-one", files: [{ path: "core/src/policy/example.ts" }] } as unknown as ProtectedGrant;
const consumption = { id: "activation-one" } as unknown as ProtectedGrantConsumption;
const policy: ProtectedPermissionBinding = { profile: "builder", tools: [], writes: [], protectedPaths: [] };

test("the write capability keeps its grant paths and kind when the verifier returns others (B3-31)", () => {
  const verified = { grant, consumption, policy, kind: "preserve", paths: ["core/src/policy/evil.ts"] };
  const capability = mintWriteCapability(verified);
  assert.equal(protectedExemptionAllows(capability, "core/src/policy/example.ts", "write"), true);
  assert.equal(protectedExemptionAllows(capability, "core/src/policy/evil.ts", "write"), false);
  assert.equal(protectedWriteContext(capability)?.grant, grant);
});

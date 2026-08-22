import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContractProjection } from "../registry/contracts.ts";
import { GateReport } from "./interface.ts";

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readArtifact(path: string): { readonly digest: string } | { readonly error: string } {
  try {
    return { digest: sha256(readFileSync(path)) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { error: "missing" };
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    return { error: code ?? (error instanceof Error ? error.message : String(error)) };
  }
}

/** Checks only this worktree's declared contract artifacts against their byte digests. */
export function contractDigest(repositoryRoot: string): GateReport {
  const report = new GateReport("contract_digest", { passWhenEmpty: true });
  let projectionText: string;
  try {
    projectionText = readFileSync(join(repositoryRoot, "awsf.contracts.yaml"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return report;
    throw error;
  }

  for (const contract of loadContractProjection(projectionText).contracts) {
    const observed = readArtifact(join(repositoryRoot, contract.path));
    const observedDigest = "digest" in observed ? observed.digest : observed.error;
    report.check(
      `contract ${contract.id}: ${contract.path}`,
      "digest" in observed && observed.digest === contract.digest,
      `expected=${contract.digest}; observed=${observedDigest}`,
    );
  }
  return report;
}

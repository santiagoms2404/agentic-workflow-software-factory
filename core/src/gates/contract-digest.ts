import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readContractArtifactDigestSync } from "../contracts/artifact-digest.ts";
import { loadContractProjection } from "../registry/contracts.ts";
import { GateReport } from "./interface.ts";

function readArtifact(path: string): { readonly digest: string } | { readonly error: string } {
  return readContractArtifactDigestSync(path, (error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "missing";
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    return code ?? (error instanceof Error ? error.message : String(error));
  });
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

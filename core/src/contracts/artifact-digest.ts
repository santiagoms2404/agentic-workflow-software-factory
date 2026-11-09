import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { contractByteDigest } from "./hash.ts";

export type ContractArtifactDigestResult =
  | { readonly digest: string }
  | { readonly error: string };

export type ContractArtifactReadError = (error: unknown) => string;

/** Reads and digests the exact bytes of a contract artifact without text decoding. */
export async function readContractArtifactDigest(
  path: string,
  formatError: ContractArtifactReadError,
): Promise<ContractArtifactDigestResult> {
  try {
    return { digest: contractByteDigest(await readFile(path)) };
  } catch (error) {
    return { error: formatError(error) };
  }
}

/** Synchronous counterpart for gates whose report contract is synchronous. */
export function readContractArtifactDigestSync(
  path: string,
  formatError: ContractArtifactReadError,
): ContractArtifactDigestResult {
  try {
    return { digest: contractByteDigest(readFileSync(path)) };
  } catch (error) {
    return { error: formatError(error) };
  }
}

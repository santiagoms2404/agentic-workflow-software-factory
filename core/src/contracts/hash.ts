import { createHash } from "node:crypto";

/** SHA-256 over UTF-8 text, shared by persisted contract digests. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Contract artifact digest: SHA-256 of the supplied bytes with its wire prefix. */
export function contractByteDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

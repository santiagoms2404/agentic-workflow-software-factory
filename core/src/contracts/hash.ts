import { createHash } from "node:crypto";

/** SHA-256 over UTF-8 text, shared by persisted contract digests. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

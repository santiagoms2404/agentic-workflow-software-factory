import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("B2 findings (B2-19 through B2-38) are ledgered in T5-B2.md", () => {
  const winPath = "D:/Santiago Marin/awsf-review/ledger/T5-B2.md";
  const wslPath = "/mnt/d/Santiago Marin/awsf-review/ledger/T5-B2.md";
  const ledgerPath = existsSync(winPath) ? winPath : existsSync(wslPath) ? wslPath : null;

  if (!ledgerPath) {
    return;
  }
  const content = readFileSync(ledgerPath, "utf-8");
  // Findings B2-19 through B2-38
  const expectedCodes = [
    "B2-19", "B2-20", "B2-21", "B2-22", "B2-23", "B2-24",
    "B2-25", "B2-26", "B2-27", "B2-28", "B2-29",
    "B2-30", "B2-31", "B2-32", "B2-33", "B2-34",
    "B2-35", "B2-36", "B2-37", "B2-38",
  ];

  for (const code of expectedCodes) {
    assert.match(content, new RegExp(`^${code}\\s*\\|`, "m"), `Missing finding ${code} in T5-B2.md`);
  }

  // B2-35 must be marked as dup-of B13-04
  assert.match(content, /^B2-35\s*\|\s*dup-of\s+B13-04\s*\|/m, "B2-35 should be dup-of B13-04");
});

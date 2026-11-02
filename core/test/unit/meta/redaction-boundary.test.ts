import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const BOUNDARIES = [
  "core/src/persistence/journal.ts",
  "core/src/persistence/status-store.ts",
  "core/src/observability/projector.ts",
  "core/src/config/effective-config.ts",
  "core/src/api/responses.ts",
  "core/src/adapters/env.ts",
  "core/src/cli/commands/rework.ts",
  "core/src/decision/jev-transport.ts",
  "core/src/git/publish.ts",
  "core/src/planning/store.ts",
];

const SCRUB_IMPORT = /(?:import\s+[\s\S]*?from\s+['"][^'"]*policy\/redaction(?:\.ts)?['"])/;
const SCRUB_CALL = /\b(?:scrubCredentials|scrubCredentialString|containsCredential|stringifyRedacted|scrubJsonText)\s*\(/;

function usesSharedCredentialScrubber(source: string): boolean {
  return SCRUB_IMPORT.test(source) && SCRUB_CALL.test(source);
}

const PATTERNS_DEFINITION = /(?:export\s+)?const\s+CREDENTIAL_PATTERNS\s*(?::\s*[^=]+)?=/;

test("every current persistence/display/provider boundary uses the shared credential scrubber", () => {
  const offenders = BOUNDARIES.filter((path) => {
    const source = readFileSync(join(repoRoot(), path), "utf8");
    return !usesSharedCredentialScrubber(source);
  });
  assert.deepEqual(offenders, []);
});

test("boundary check rejects comments or imports without active scrubber calls", () => {
  const commentOnly = '// see policy/redaction.ts for details\nexport const unscrubbed = "pass";';
  assert.equal(usesSharedCredentialScrubber(commentOnly), false);
  const importOnly = 'import { scrubCredentials } from "../policy/redaction.ts";\nexport const raw = "uncalled";';
  assert.equal(usesSharedCredentialScrubber(importOnly), false);
});

test("credential-shape definitions have one production owner", () => {
  const productionFiles = [
    ...walkFiles(join(repoRoot(), "core", "src")),
    ...walkFiles(join(repoRoot(), "dashboard", "src")),
    ...walkFiles(join(repoRoot(), "dashboard", "shared")),
  ].map(relRepo);

  const owners = productionFiles.filter((path) => {
    const source = readFileSync(join(repoRoot(), path), "utf8");
    return PATTERNS_DEFINITION.test(source);
  });
  assert.deepEqual(owners, ["dashboard/shared/credential-patterns.ts"]);
});

test("second credential vocabulary definition is caught, even non-exported", () => {
  const nonExported = "const CREDENTIAL_PATTERNS = [ /sk-[a-z0-9]+/ ];";
  assert.equal(PATTERNS_DEFINITION.test(nonExported), true);
});

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
  "core/src/execution/process-environment.ts",
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

test("the adapter gate boundary delegates to the shared process-environment refusal", () => {
  const adapterEnv = readFileSync(join(repoRoot(), "core/src/adapters/env.ts"), "utf8");
  const processEnvironment = readFileSync(join(repoRoot(), "core/src/execution/process-environment.ts"), "utf8");
  assert.match(adapterEnv, /import \{ admitEnvironmentEntry, filterEnv \} from "\.\.\/execution\/process-environment\.ts"/u);
  assert.match(adapterEnv, /filterEnv\(GATE_ENV_LABEL, source\)/u);
  assert.match(adapterEnv, /admitEnvironmentEntry\(GATE_ENV_LABEL, key, value\)/u);
  assert.equal(usesSharedCredentialScrubber(processEnvironment), true);
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

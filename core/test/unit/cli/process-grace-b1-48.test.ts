import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const configuredGrace = "terminate: { graceMs: options.config.runtime.process_grace_seconds * 1_000 },";
const callers = [
  "../../../src/cli/commands/production-run.ts",
  "../../../src/cli/commands/review-phase.ts",
  "../../../src/cli/commands/rework.ts",
] as const;

test("provider brokers use the configured process cancellation grace", () => {
  for (const path of callers) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(source.includes(configuredGrace), `${path} must pass runtime.process_grace_seconds to BrokerOptions`);
  }
});

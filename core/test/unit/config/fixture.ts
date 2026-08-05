import type { AwsfConfig } from "../../../src/config/schema.ts";

// A minimal, fully valid awsf/v1 config used across the config test suites.
// Mutate a deep clone per test rather than sharing references.
export function validConfig(): AwsfConfig {
  return {
    schema: "awsf/v1",
    project: { name: "Test Project", slug: "test-project" },
    runtime: { default_workflow: "build-review", default_tier: 1, poll_ms: 2000 },
    adapters: [
      { id: "claude-code", kind: "claude-code", enabled: true },
      { id: "pi-codex", kind: "pi-codex", enabled: true },
      { id: "stub", kind: "stub", enabled: true },
    ],
    routing: { review: "invert-provider", no_fallback: true },
    agents: [
      {
        name: "builder",
        model: "claude-sonnet-5",
        thinking: "medium",
        color: "#22D3EE",
        purpose: "Implements the plan's steps.",
        prompt: "prompts/builder.md",
        harness: "claude-code",
        tools: ["Read", "Write", "Edit"],
        writes: ["**"],
      },
      {
        name: "reviewer",
        model: "pi-codex-terra",
        thinking: "medium",
        color: "#F43F5E",
        purpose: "Reviews the committed candidate diff.",
        prompt: "prompts/reviewer.md",
        harness: "pi-codex",
        tools: ["Read"],
        writes: [],
      },
    ],
    workflows: [
      { id: "build", enabled: true },
      { id: "build-review", enabled: true },
    ],
    gates: {
      envelope: { kind: "envelope_valid" },
      unit_tests: { kind: "commands_pass", argv: ["npm", "run", "test:unit"] },
    },
    risk: {
      tier_ceilings: { "0": 1, "1": 3, "2": 5 },
      paths: [{ pattern: "core/src/persistence/**", tier: 2 }],
    },
    policy: { protected_paths: ["AGENTS.md", "awsf.config.yaml"] },
    observability: { redaction_level_default: "public" },
    pricing: [],
  };
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

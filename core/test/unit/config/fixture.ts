import type { AwsfConfig } from "../../../src/config/schema.ts";

// A minimal, fully valid awsf/v1 config used across the config test suites.
// Mutate a deep clone per test rather than sharing references.
export function validConfig(): AwsfConfig {
  return {
    schema: "awsf/v1",
    project: { slug: "test-project", default_workflow: "build-review" },
    runtime: {
      silence_timeout_seconds: 2700,
      process_grace_seconds: 2,
      max_output_bytes: 67108864,
      max_event_count: 100000,
      seed_paths: [],
    },
    adapters: {
      claude: { kind: "claude-code", executable: "claude" },
      codex: { kind: "pi-codex", executable: "pi", provider: "openai-codex" },
      stub: { kind: "fixture" },
    },
    routing: { default_worker: "claude", review: "invert-provider", no_fallback: true },
    agents: [
      {
        name: "builder",
        model: "codex:gpt-5.6-sol",
        thinking: "high",
        color: "#22D3EE",
        purpose: "Implements the plan's steps.",
        prompt: { system: "prompts/builder/system.md", user: "prompts/builder/user.md" },
        harness: { adapter: "codex", continuity: "same-session" },
        tools: { profile: "managed-worker", allow: ["read", "write", "exec"] },
        writes: ["core/src/**"],
      },
      {
        name: "reviewer",
        model: "claude:opus",
        thinking: "high",
        color: "#F43F5E",
        purpose: "Reviews the committed candidate diff.",
        prompt: { system: "prompts/reviewer/system.md", user: "prompts/reviewer/user.md" },
        harness: { adapter: "claude", continuity: "none" },
        tools: { profile: "no-tools", allow: [] },
        writes: [],
      },
    ],
    workflows: { enabled: ["build", "build-review"] },
    gates: {
      test: { argv: ["npm", "run", "test:unit"], timeout_seconds: 600 },
    },
    risk: {
      default: "T1",
      call_ceiling: { T0: 1, T1: 3, T2: 5 },
      correction_allowance: { auto: 1, owner: 1 },
      paths: { "core/src/persistence/**": "T2" },
    },
    policy: {
      protected_paths: ["AGENTS.md", "awsf.config.yaml"],
      protected_operations: ["delete", "migration"],
    },
    observability: { poll_ms: 500, db: "state://awsf.db", persist_thinking_text: false },
    pricing: { display_mode: "estimated-api-equivalent", effective_date: null, models: {} },
  };
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

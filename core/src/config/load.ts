import { Value } from "@sinclair/typebox/value";
import { parse as parseYaml } from "yaml";
import { normalizeRepositoryPath } from "../policy/path-policy.ts";
import { containsCredential } from "../policy/redaction.ts";
import {
  AwsfConfigSchema,
  KNOWN_ADAPTER_KINDS,
  KNOWN_GATE_IDS,
  KNOWN_PROTECTED_OPERATIONS,
  KNOWN_WORKFLOW_IDS,
  type AwsfConfig,
} from "./schema.ts";
import { MAX_CALL_CEILING, MIN_CALL_CEILING } from "../state/tiers.ts";
import { assertNoAbsolutePaths, scanStrings } from "./machine-path.ts";

// Every rejection this loader can throw. Kept as one closed class hierarchy
// (not exceptions of convenience) so tests can assert on `code`/`instanceof`
// rather than message text.
export class ConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ConfigError";
  }
}

export class ConfigSchemaError extends ConfigError {
  readonly violations: string[];
  constructor(violations: string[]) {
    super("E_CONFIG_SCHEMA", `config does not match awsf/v1: ${violations.join("; ")}`);
    this.name = "ConfigSchemaError";
    this.violations = violations;
  }
}

export class ConfigAbsolutePathError extends ConfigError {
  constructor(path: string, value: string) {
    super("E_CONFIG_ABSOLUTE_PATH", `${path} looks like an absolute machine path: "${value}"`);
    this.name = "ConfigAbsolutePathError";
  }
}

export class ConfigCredentialShapedError extends ConfigError {
  constructor(path: string) {
    super("E_CONFIG_CREDENTIAL", `${path} holds a credential-shaped value`);
    this.name = "ConfigCredentialShapedError";
  }
}

export class ConfigUnknownAdapterError extends ConfigError {
  constructor(kind: string) {
    super("E_CONFIG_UNKNOWN_ADAPTER", `unknown adapter kind: "${kind}"`);
    this.name = "ConfigUnknownAdapterError";
  }
}

export class ConfigUnverifiedAdapterError extends ConfigError {
  constructor(adapterId: string) {
    super(
      "E_CONFIG_ADAPTER_UNVERIFIED",
      `adapters.${adapterId} enables antigravity without verified: true; capture and read one bounded agy stream first`,
    );
    this.name = "ConfigUnverifiedAdapterError";
  }
}

export class ConfigUnknownWorkflowError extends ConfigError {
  constructor(id: string) {
    super("E_CONFIG_UNKNOWN_WORKFLOW", `unknown workflow id: "${id}"`);
    this.name = "ConfigUnknownWorkflowError";
  }
}

export class ConfigUnknownGateError extends ConfigError {
  constructor(id: string) {
    super("E_CONFIG_UNKNOWN_GATE", `unknown gate id: "${id}"`);
    this.name = "ConfigUnknownGateError";
  }
}

export class ConfigUnknownAdapterReferenceError extends ConfigError {
  constructor(referrer: string, adapterId: string) {
    super("E_CONFIG_UNKNOWN_ADAPTER_REF", `${referrer} names undeclared adapter "${adapterId}"`);
    this.name = "ConfigUnknownAdapterReferenceError";
  }
}

export class ConfigUnknownProtectedOperationError extends ConfigError {
  constructor(operation: string) {
    super("E_CONFIG_UNKNOWN_PROTECTED_OPERATION", `unknown protected operation: "${operation}"`);
    this.name = "ConfigUnknownProtectedOperationError";
  }
}

/**
 * The ceiling is an owner-set number, so the loader checks that it is a NUMBER
 * OF CALLS rather than checking it against a shortlist. The three-value
 * allowlist this replaced made `risk.call_ceiling` look like a dial while
 * admitting only the values the hardcoded constant already had.
 */
export class ConfigInvalidCeilingError extends ConfigError {
  constructor(tier: string, ceiling: number) {
    super(
      "E_CONFIG_INVALID_CEILING",
      `risk.call_ceiling.${tier} = ${ceiling} is not a whole number of calls from ${MIN_CALL_CEILING} through ${MAX_CALL_CEILING}`,
    );
    this.name = "ConfigInvalidCeilingError";
  }
}

export class ConfigInvalidNoFallbackError extends ConfigError {
  constructor(value: unknown) {
    super(
      "E_CONFIG_INVALID_NO_FALLBACK",
      `routing.no_fallback must be exactly \`true\`, got ${JSON.stringify(value)}`,
    );
    this.name = "ConfigInvalidNoFallbackError";
  }
}

export class ConfigInvalidPersistThinkingError extends ConfigError {
  constructor(value: unknown) {
    super(
      "E_CONFIG_INVALID_PERSIST_THINKING",
      `observability.persist_thinking_text must be exactly \`false\` (invariant 9), got ${JSON.stringify(value)}`,
    );
    this.name = "ConfigInvalidPersistThinkingError";
  }
}

export class ConfigInvalidSeedPathError extends ConfigError {
  constructor(path: string, detail: string) {
    super("E_CONFIG_INVALID_SEED_PATH", `runtime.seed_paths entry ${JSON.stringify(path)} is invalid: ${detail}`);
    this.name = "ConfigInvalidSeedPathError";
  }
}

function assertNoCredentialShapedValues(doc: unknown): void {
  scanStrings(doc, "", (path, value) => {
    if (containsCredential(value)) {
      throw new ConfigCredentialShapedError(path);
    }
  });
}

function assertValidSeedPaths(config: AwsfConfig): void {
  const normalized: string[] = [];
  for (const path of config.runtime.seed_paths) {
    try {
      normalized.push(normalizeRepositoryPath(path));
    } catch (error) {
      throw new ConfigInvalidSeedPathError(path, error instanceof Error ? error.message : String(error));
    }
  }
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const a = normalized[left]!;
      const b = normalized[right]!;
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        throw new ConfigInvalidSeedPathError(
          config.runtime.seed_paths[right]!,
          `seed paths may not duplicate or overlap ${JSON.stringify(config.runtime.seed_paths[left])}`,
        );
      }
    }
  }
}

function assertKnownReferences(config: AwsfConfig): void {
  const declaredAdapterIds = new Set(Object.keys(config.adapters));

  for (const [adapterId, adapter] of Object.entries(config.adapters)) {
    if (!(KNOWN_ADAPTER_KINDS as readonly string[]).includes(adapter.kind)) {
      throw new ConfigUnknownAdapterError(adapter.kind);
    }
    // Q1's default is a shipped but inert slot. `enabled: true` therefore
    // needs a separate, explicit attestation; otherwise a typo turns an
    // unread provider protocol into a run path.
    if (adapter.kind === "antigravity" && adapter.enabled === true && adapter.verified !== true) {
      throw new ConfigUnverifiedAdapterError(adapterId);
    }
  }

  if (!declaredAdapterIds.has(config.routing.default_worker)) {
    throw new ConfigUnknownAdapterReferenceError("routing.default_worker", config.routing.default_worker);
  }

  for (const agent of config.agents) {
    if (!declaredAdapterIds.has(agent.harness.adapter)) {
      throw new ConfigUnknownAdapterReferenceError(`agents["${agent.name}"].harness.adapter`, agent.harness.adapter);
    }
  }

  for (const id of config.workflows.enabled) {
    if (!(KNOWN_WORKFLOW_IDS as readonly string[]).includes(id)) {
      throw new ConfigUnknownWorkflowError(id);
    }
  }
  if (!(KNOWN_WORKFLOW_IDS as readonly string[]).includes(config.project.default_workflow)) {
    throw new ConfigUnknownWorkflowError(config.project.default_workflow);
  }

  for (const id of Object.keys(config.gates)) {
    if (!(KNOWN_GATE_IDS as readonly string[]).includes(id)) {
      throw new ConfigUnknownGateError(id);
    }
  }

  for (const operation of config.policy.protected_operations) {
    if (!(KNOWN_PROTECTED_OPERATIONS as readonly string[]).includes(operation)) {
      throw new ConfigUnknownProtectedOperationError(operation);
    }
  }
}

function assertValidCeilings(config: AwsfConfig): void {
  for (const [tier, ceiling] of Object.entries(config.risk.call_ceiling)) {
    if (!Number.isInteger(ceiling) || ceiling < MIN_CALL_CEILING || ceiling > MAX_CALL_CEILING) {
      throw new ConfigInvalidCeilingError(tier, ceiling);
    }
  }
}

function assertNoFallbackIsTrue(config: AwsfConfig): void {
  if (config.routing.no_fallback !== true) {
    throw new ConfigInvalidNoFallbackError(config.routing.no_fallback);
  }
}

function assertThinkingNeverPersisted(config: AwsfConfig): void {
  if (config.observability.persist_thinking_text !== false) {
    throw new ConfigInvalidPersistThinkingError(config.observability.persist_thinking_text);
  }
}

/**
 * Parses and validates `awsf.config.yaml` text against the `awsf/v1`
 * schema (specs/awsf-architecture-proposal.md §7.3.5), then applies the
 * loader's own hard rejections in this order: TypeBox structural
 * validation, absolute machine paths, credential-shaped values, normalized
 * non-overlapping repository seed paths, unknown or unverified adapter references,
 * workflow/gate/protected-operation references, tier ceilings outside
 * `MIN_CALL_CEILING`..`MAX_CALL_CEILING`, `routing.no_fallback` other than `true`, and
 * `observability.persist_thinking_text` other than `false`.
 */
export function loadConfig(yamlText: string): AwsfConfig {
  const doc: unknown = parseYaml(yamlText);

  if (!Value.Check(AwsfConfigSchema, doc)) {
    const violations = [...Value.Errors(AwsfConfigSchema, doc)].map((e) => `${e.path || "(root)"}: ${e.message}`);
    throw new ConfigSchemaError(violations);
  }
  const config = doc as AwsfConfig;

  assertNoAbsolutePaths(doc, ConfigAbsolutePathError);
  assertNoCredentialShapedValues(doc);
  assertValidSeedPaths(config);
  assertKnownReferences(config);
  assertValidCeilings(config);
  assertNoFallbackIsTrue(config);
  assertThinkingNeverPersisted(config);

  return config;
}

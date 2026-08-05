import { Value } from "@sinclair/typebox/value";
import { parse as parseYaml } from "yaml";
import {
  AwsfConfigSchema,
  KNOWN_ADAPTER_KINDS,
  KNOWN_GATE_IDS,
  KNOWN_PROTECTED_OPERATIONS,
  KNOWN_WORKFLOW_IDS,
  VALID_TIER_CEILINGS,
  type AwsfConfig,
} from "./schema.ts";

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

export class ConfigInvalidCeilingError extends ConfigError {
  constructor(tier: string, ceiling: number) {
    super(
      "E_CONFIG_INVALID_CEILING",
      `risk.call_ceiling.${tier} = ${ceiling} is not one of {${VALID_TIER_CEILINGS.join(",")}}`,
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

// Absolute POSIX paths, Windows drive-letter paths, UNC paths, and
// home-relative paths. A committed config is "durable intent" — it must
// never encode where anything lives on any one machine.
const ABSOLUTE_PATH_PATTERN = /^(\/|[A-Za-z]:[\\/]|\\\\|~)/;

// Deliberately conservative and shared in spirit with the credential-pattern
// meta-test: this is a loader-side hard rejection, not a redaction scrubber.
const CREDENTIAL_SHAPED_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{36}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /^Bearer\s+\S+/,
  /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/, // JWT-shaped
];

function isAbsoluteMachinePath(value: string): boolean {
  return ABSOLUTE_PATH_PATTERN.test(value);
}

function isCredentialShaped(value: string): boolean {
  return CREDENTIAL_SHAPED_PATTERNS.some((pattern) => pattern.test(value));
}

// Walks every string leaf in the parsed document — object keys AND values,
// array items — in document order, and throws on the first offender via
// `onLeaf`. Keys are scanned too: adapter ids, gate ids, and risk.paths
// globs are all object keys, not values, and must be held to the same bar.
function scanStrings(node: unknown, path: string, onLeaf: (path: string, value: string) => void): void {
  if (typeof node === "string") {
    onLeaf(path, node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanStrings(item, `${path}[${index}]`, onLeaf));
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const keyPath = path === "" ? key : `${path}.${key}`;
      onLeaf(`${keyPath} (key)`, key);
      scanStrings(value, keyPath, onLeaf);
    }
  }
}

function assertNoAbsolutePaths(doc: unknown): void {
  scanStrings(doc, "", (path, value) => {
    if (isAbsoluteMachinePath(value)) {
      throw new ConfigAbsolutePathError(path, value);
    }
  });
}

function assertNoCredentialShapedValues(doc: unknown): void {
  scanStrings(doc, "", (path, value) => {
    if (isCredentialShaped(value)) {
      throw new ConfigCredentialShapedError(path);
    }
  });
}

function assertKnownReferences(config: AwsfConfig): void {
  const declaredAdapterIds = new Set(Object.keys(config.adapters));

  for (const adapter of Object.values(config.adapters)) {
    if (!(KNOWN_ADAPTER_KINDS as readonly string[]).includes(adapter.kind)) {
      throw new ConfigUnknownAdapterError(adapter.kind);
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
    if (!(VALID_TIER_CEILINGS as readonly number[]).includes(ceiling)) {
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
 * validation, absolute machine paths, credential-shaped values, unknown
 * adapter/workflow/gate/protected-operation references, tier ceilings
 * outside {1,3,5}, `routing.no_fallback` other than `true`, and
 * `observability.persist_thinking_text` other than `false`.
 */
export function loadConfig(yamlText: string): AwsfConfig {
  const doc: unknown = parseYaml(yamlText);

  if (!Value.Check(AwsfConfigSchema, doc)) {
    const violations = [...Value.Errors(AwsfConfigSchema, doc)].map((e) => `${e.path || "(root)"}: ${e.message}`);
    throw new ConfigSchemaError(violations);
  }
  const config = doc as AwsfConfig;

  assertNoAbsolutePaths(doc);
  assertNoCredentialShapedValues(doc);
  assertKnownReferences(config);
  assertValidCeilings(config);
  assertNoFallbackIsTrue(config);
  assertThinkingNeverPersisted(config);

  return config;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvelope } from "../../../src/contracts/parse-envelope.ts";
import { ENVELOPE_SCHEMAS } from "../../../src/contracts/registry.ts";
import { CREDENTIAL_PATTERNS } from "../../../src/policy/redaction.ts";
import { ABSOLUTE_PATH } from "../meta/_fixture-scrub.ts";
import { repoRoot } from "../meta/_walk.ts";

const FIXTURE_DIR = join(repoRoot(), "core", "test", "fixtures", "stages");
const STAGE_CAPTURE_IDS = ["S1", "S2", "S3", "S4", "S5"] as const;
const REQUIRED_STAGE_FIELDS = ["id", "ordinal", "owner", "producer", "granularity", "entryPrecondition"] as const;

// `newCommand` mints v4 UUID session ids; attempts are stored below this path;
// production runs derive their ids from the session id and phase id.
const SESSION_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const ATTEMPT_DIRECTORY = /(?:^|[\\/])projects[\\/][^\\/]+[\\/]tasks[\\/][^\\/]+[\\/][1-9][0-9]*(?:$|[\\/])/;
const RUN_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:\s]+:run(?:-[1-9][0-9]*)?(?::c[1-9][0-9]*)?\b/i;

function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort();
}

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function isValidationViolation(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.kind === "string" && typeof candidate.path === "string" &&
    typeof candidate.message === "string" && Object.hasOwn(candidate, "received");
}

function stringValues(value: unknown, label: string, skipAbsolutePath = false): Array<{ label: string; value: string; skipAbsolutePath: boolean }> {
  if (typeof value === "string") return [{ label, value, skipAbsolutePath }];
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringValues(item, `${label}[${index}]`));

  const parentIsViolation = isValidationViolation(value);
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    stringValues(child, `${label}.${key}`, parentIsViolation && key === "path"),
  );
}

function subjectFromCapture(capture: Record<string, unknown>, subject: unknown): unknown {
  if (typeof subject !== "string") assert.fail("schema-fit subject must be a string");
  if (subject === "output") return capture.output;

  const match = /^output\.storedEnvelopes\[([^\]]+)]\.payload$/.exec(subject);
  if (match?.[1] === undefined) assert.fail(`unsupported schema-fit subject: ${subject}`);
  const envelopeName = match[1];
  const output = record(capture.output, "capture output");
  const envelopes = record(output.storedEnvelopes, "capture storedEnvelopes");
  const raw = envelopes[envelopeName];
  if (typeof raw !== "string") assert.fail(`missing stored envelope ${envelopeName}`);
  return record(JSON.parse(raw), `stored envelope ${envelopeName}`).payload;
}

test("every stage fixture parses as JSON", () => {
  const names = fixtureNames();
  assert.ok(names.length > 0, "the stage fixture directory is empty");
  for (const name of names) assert.doesNotThrow(() => readFixture(name), name);
});

test("stages.json records five contiguous stage entries with the required fields", () => {
  const stages = record(readFixture("stages.json"), "stages.json");
  assert.ok(Array.isArray(stages.stages), "stages.json.stages must be an array");
  assert.equal(stages.stages.length, 5);

  for (const [index, stage] of stages.stages.entries()) {
    const entry = record(stage, `stages.json.stages[${index}]`);
    assert.equal(entry.ordinal, index + 1);
    for (const field of REQUIRED_STAGE_FIELDS) {
      assert.ok(Object.hasOwn(entry, field), `stages.json.stages[${index}] is missing ${field}`);
      assert.notEqual(entry[field], "", `stages.json.stages[${index}].${field} is empty`);
    }
  }
});

test("stage fixtures contain no credential, absolute machine path, or live record identifier", () => {
  const offenders: string[] = [];
  for (const name of fixtureNames()) {
    for (const entry of stringValues(readFixture(name), name)) {
      if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(entry.value))) {
        offenders.push(`${entry.label}: credential-shaped value`);
      }
      if (!entry.skipAbsolutePath && ABSOLUTE_PATH.test(entry.value)) {
        offenders.push(`${entry.label}: absolute path ${JSON.stringify(entry.value)}`);
      }
      if (SESSION_ID.test(entry.value) || ATTEMPT_DIRECTORY.test(entry.value) || RUN_ID.test(entry.value)) {
        offenders.push(`${entry.label}: live session, attempt, or run identifier`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("schema-fit.json covers each capture and re-verifies every recorded fit", () => {
  const table = record(readFixture("schema-fit.json"), "schema-fit.json");
  assert.deepEqual(Object.keys(table).sort(), [...STAGE_CAPTURE_IDS]);

  for (const stageId of STAGE_CAPTURE_IDS) {
    const row = record(table[stageId], `schema-fit.json.${stageId}`);
    const hasFit = Object.hasOwn(row, "fits");
    const hasMisfit = Object.hasOwn(row, "misfit");
    assert.notEqual(hasFit, hasMisfit, `${stageId} must record exactly one of fits or misfit`);

    if (!hasFit) continue;
    if (typeof row.fits !== "string") assert.fail(`${stageId}.fits must be a schema id`);
    const schemaId = row.fits;
    assert.ok(Object.hasOwn(ENVELOPE_SCHEMAS, schemaId), `${stageId}.fits is not an imported schema id`);

    const capture = record(readFixture(`${stageId}.json`), `${stageId}.json`);
    const result = parseEnvelope(JSON.stringify(subjectFromCapture(capture, row.subject)), schemaId);
    assert.equal(result.valid, true, `${stageId}.fits did not validate when parsed again`);
  }
});

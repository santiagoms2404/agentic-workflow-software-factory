import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, relRepo, walkFiles } from "./_walk.ts";
import { DRIVING_REL, drivingDocs } from "./_driving.ts";
import { OUTPUT_SCHEMA_PLACEHOLDER } from "../../../src/contracts/json-schema.ts";

// AWSF never maintains a handwritten envelope example beside the schema and the
// gate; that three-copy drift is SSSF's worst maintenance defect. Prompts
// declare `{output_schema}` and the compiler substitutes the JSON Schema
// emitted from the one TypeBox definition — so a prompt that restates an
// envelope shape by hand is a defect, not a convenience.
//
// This test is trivially green while `prompts/` holds only scaffolding, and
// load-bearing the moment T20 writes real prompt text into it.

const PROMPTS_DIR = join(repoRoot(), "prompts");
const PROMPT_EXTS = [".md", ".txt", ".hbs", ".mustache"];

/** Each pattern names a way a prompt could restate a schema instead of asking for it. */
const HANDWRITTEN_SCHEMA_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // A JSON Schema document pasted into the prompt.
  { name: "inline JSON Schema keyword", pattern: /"\$schema"\s*:|"additionalProperties"\s*:|"\$id"\s*:/ },
  { name: 'inline `"type": "object"`', pattern: /"type"\s*:\s*"object"/ },
  // An envelope example transcribed by hand.
  { name: "envelope schema id literal", pattern: /awsf\.[a-z-]+-output\/v1/ },
  { name: "EnvelopeBase field transcribed", pattern: /"?(producerStatus|notesForNextPhase)"?\s*:/ },
  {
    name: "phase envelope field transcribed",
    pattern:
      /"?(implementationSteps|acceptanceCriteria|changedFiles|commandsRun|proposedCommitMessage|candidateSha|reviewedSha|documentedAreas|outputTail|nonGoals|testStrategy)"?\s*:/,
  },
  // A TypeScript interface pasted in as documentation.
  { name: "TypeScript interface declaration", pattern: /\binterface\s+\w*(Output|Envelope|ArtifactClaim)\b/ },
];

/**
 * The subset that applies to the driving-document tree. It is a NARROWING, and
 * the three that are left out are left out on purpose:
 *
 *   - the two field-name patterns match ordinary explanation. A cookbook line
 *     reading `changedFiles: the host-observed set of paths` is a sentence, not
 *     a transcribed schema, and a fence that fails on it teaches authors to
 *     stop naming fields — which is most of what a cookbook is for.
 *   - `"type": "object"` matches an ordinary config example.
 *
 * What survives cannot be explanation: a schema id literal, a JSON Schema
 * keyword, and a pasted TypeScript declaration. Plus the ```json fence ban,
 * which a driving document has no legitimate use for — it may never restate a
 * schema, so it never needs to show one.
 */
const DRIVING_PATTERN_NAMES = new Set([
  "inline JSON Schema keyword",
  "envelope schema id literal",
  "TypeScript interface declaration",
]);

const DRIVING_SCHEMA_PATTERNS = HANDWRITTEN_SCHEMA_PATTERNS.filter(({ name }) => DRIVING_PATTERN_NAMES.has(name));

function promptFiles(): string[] {
  return walkFiles(PROMPTS_DIR, PROMPT_EXTS);
}

function schemaOffences(files: string[], patterns: typeof HANDWRITTEN_SCHEMA_PATTERNS): string[] {
  const offences: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const { name, pattern } of patterns) {
      const match = pattern.exec(text);
      if (match !== null) {
        const line = text.slice(0, match.index).split("\n").length;
        offences.push(`${relRepo(file)}:${line} — ${name} (${JSON.stringify(match[0])})`);
      }
    }
  }
  return offences;
}

const JSON_FENCE = /```json\b/;

function jsonFenceOffences(files: string[]): string[] {
  const offences: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const match = JSON_FENCE.exec(text);
    if (match !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      offences.push(`${relRepo(file)}:${line}`);
    }
  }
  return offences;
}

test("no prompt under prompts/ contains a handwritten envelope schema or example", () => {
  const offences = schemaOffences(promptFiles(), HANDWRITTEN_SCHEMA_PATTERNS);
  assert.deepEqual(
    offences,
    [],
    `handwritten schema content found under prompts/. Use ${OUTPUT_SCHEMA_PLACEHOLDER} and let the ` +
      `compiler emit the schema from core/src/contracts/:\n  ${offences.join("\n  ")}`,
  );
});

test("no prompt hand-rolls a JSON code fence for its output contract", () => {
  const offences = jsonFenceOffences(promptFiles());
  assert.deepEqual(
    offences,
    [],
    `a \`\`\`json fence in a prompt is a schema copy waiting to drift; use ${OUTPUT_SCHEMA_PLACEHOLDER}:\n  ${offences.join("\n  ")}`,
  );
});

test("the meta-test's own patterns actually bite", () => {
  // Guards against the failure mode where this file silently stops matching
  // anything and reports green forever.
  const specimen = [
    '{ "schema": "awsf.build-output/v1", "producerStatus": "success" }',
    '{ "changedFiles": [], "proposedCommitMessage": "x" }',
    '{ "type": "object", "additionalProperties": false }',
    "interface BuildOutput extends EnvelopeBase {}",
  ].join("\n");
  const matched = HANDWRITTEN_SCHEMA_PATTERNS.filter(({ pattern }) => pattern.test(specimen));
  assert.equal(matched.length, HANDWRITTEN_SCHEMA_PATTERNS.length);
});

// ---------------------------------------------------------------------------
// The driving-document tree. Same principle — a document that restates a schema
// is a second source of truth that goes wrong quietly — with a narrowed pattern
// set, because a cookbook explains fields for a living and a prompt does not.
//
// Both tests are vacuous until docs/driving/ exists: `walkFiles` returns [] for
// a missing directory. The two after them are what make them real.
// ---------------------------------------------------------------------------

test("no driving document restates an envelope schema by hand", () => {
  const offences = schemaOffences(drivingDocs(), DRIVING_SCHEMA_PATTERNS);
  assert.deepEqual(
    offences,
    [],
    `a driving document points at core/src/contracts/ and never restates what it defines:\n  ${offences.join("\n  ")}`,
  );
});

test("no driving document hand-rolls a JSON code fence", () => {
  const offences = jsonFenceOffences(drivingDocs());
  assert.deepEqual(
    offences,
    [],
    `a \`\`\`json fence is a schema copy waiting to drift, and a driving document may not restate ` +
      `a schema at all:\n  ${offences.join("\n  ")}`,
  );
});

test("the narrowed driving-tree patterns actually bite", () => {
  const specimen = [
    "The reviewer's envelope declares awsf.review-output/v1.",
    '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }',
    "interface ReviewOutput extends EnvelopeBase {}",
  ].join("\n");
  const matched = DRIVING_SCHEMA_PATTERNS.filter(({ pattern }) => pattern.test(specimen));
  assert.equal(matched.length, DRIVING_SCHEMA_PATTERNS.length, `every applied pattern must fire on ${specimen}`);
  assert.ok(JSON_FENCE.test(["Paste the envelope:", "```json", "{}", "```"].join("\n")));
});

test("the narrowing is deliberate: the excluded patterns do not fire on ordinary cookbook prose", () => {
  // If this ever fails because the narrowed set grew, that is the point — the
  // three excluded patterns match explanation, and a fence that fails on
  // explanation gets worked around rather than obeyed.
  const prose = [
    "Read the builder's envelope. changedFiles: the host-observed set of paths it touched,",
    "and producerStatus: what the phase itself claims. They can disagree, and that gap is the",
    'whole reason the gate exists. A config block such as { "type": "object" } is illustration.',
  ].join("\n");
  assert.ok(
    HANDWRITTEN_SCHEMA_PATTERNS.some(({ pattern }) => pattern.test(prose)),
    "the prompt-scoped set is supposed to trip on this — if it does not, the narrowing proves nothing",
  );
  assert.deepEqual(
    DRIVING_SCHEMA_PATTERNS.filter(({ pattern }) => pattern.test(prose)).map(({ name }) => name),
    [],
  );
  // Guard the filter itself: it selects by NAME, so renaming a pattern above
  // would silently empty the driving set and every fence over it with it.
  assert.equal(DRIVING_SCHEMA_PATTERNS.length, DRIVING_PATTERN_NAMES.size, `${DRIVING_REL} lost a pattern to a rename`);
  assert.equal(DRIVING_SCHEMA_PATTERNS.length, 3);
});

test("prompts/ is scanned at all — the directory exists and the walker reaches it", () => {
  // `walkFiles` returns [] for a missing directory, so a moved prompts/ would
  // make the tests above vacuous. Assert the scaffolding is where we think.
  const everything = walkFiles(PROMPTS_DIR, [".gitkeep", ...PROMPT_EXTS]);
  assert.ok(everything.length > 0, "prompts/ is empty or missing — the scan above proves nothing");
});

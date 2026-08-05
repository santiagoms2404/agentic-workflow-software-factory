import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, relRepo, walkFiles } from "./_walk.ts";
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

function promptFiles(): string[] {
  return walkFiles(PROMPTS_DIR, PROMPT_EXTS);
}

test("no prompt under prompts/ contains a handwritten envelope schema or example", () => {
  const offences: string[] = [];
  for (const file of promptFiles()) {
    const text = readFileSync(file, "utf8");
    for (const { name, pattern } of HANDWRITTEN_SCHEMA_PATTERNS) {
      const match = pattern.exec(text);
      if (match !== null) {
        const line = text.slice(0, match.index).split("\n").length;
        offences.push(`${relRepo(file)}:${line} — ${name} (${JSON.stringify(match[0])})`);
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    `handwritten schema content found under prompts/. Use ${OUTPUT_SCHEMA_PLACEHOLDER} and let the ` +
      `compiler emit the schema from core/src/contracts/:\n  ${offences.join("\n  ")}`,
  );
});

test("no prompt hand-rolls a JSON code fence for its output contract", () => {
  const offences: string[] = [];
  for (const file of promptFiles()) {
    const text = readFileSync(file, "utf8");
    const match = /```json\b/.exec(text);
    if (match !== null) {
      const line = text.slice(0, match.index).split("\n").length;
      offences.push(`${relRepo(file)}:${line}`);
    }
  }
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

test("prompts/ is scanned at all — the directory exists and the walker reaches it", () => {
  // `walkFiles` returns [] for a missing directory, so a moved prompts/ would
  // make the tests above vacuous. Assert the scaffolding is where we think.
  const everything = walkFiles(PROMPTS_DIR, [".gitkeep", ...PROMPT_EXTS]);
  assert.ok(everything.length > 0, "prompts/ is empty or missing — the scan above proves nothing");
});

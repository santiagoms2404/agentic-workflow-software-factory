import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { offenders } from "./child-process-fence.test.ts";

const MODULE = "child" + "_process";

function scan(files: Record<string, string>): string[] {
  const base = mkdtempSync(join(tmpdir(), "awsf-cp-b5-09-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = join(base, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    return offenders(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// Exercise the actual walk and matcher, not a second regex copied into a test.
for (const prefix of ["node:", ""]) {
  for (const loader of ["import", "require", "process.getBuiltinModule"]) {
    test(`B5-09: ${loader} with a ${prefix || "bare "}template specifier is fenced`, () => {
      const source = `const cp = ${loader}(\`${prefix}${MODULE}\`);\n`;
      assert.deepEqual(scan({
        "core/src/probe.ts": source,
        "dashboard/src/probe.vue": `<script setup>\n${source}</script>\n`,
        "docs/driving/probe.mjs": source,
      }), ["core/src/probe.ts", "dashboard/src/probe.vue", "docs/driving/probe.mjs"]);
    });
  }
}

test("B5-09: quoted controls still bite without matching similar module names", () => {
  assert.deepEqual(scan({
    "core/src/double.ts": `const cp = import("node:${MODULE}");\n`,
    "core/src/single.cjs": `const cp = require('${MODULE}');\n`,
    "core/src/other.ts": "const fs = import(`node:fs`);\n",
    "core/src/comment.ts": `// Only the broker imports \`node:${MODULE}\`.\n`,
    "core/src/jsdoc.ts": `/** Injected, not imported: \`node:${MODULE}\`. */\n`,
    "core/src/suffix.ts": `const cp = import(\`node:${MODULE}-helper\`);\n`,
    "core/src/path.ts": `const cp = import(\`./${MODULE}\`);\n`,
    "core/src/prefix.ts": `const cp = import(\`not_${MODULE}\`);\n`,
  }), ["core/src/double.ts", "core/src/single.cjs"]);
});

test("B5-09: template spellings retain the O5 broker and shipped-code exemptions", () => {
  const source = `const cp = process.getBuiltinModule(\`node:${MODULE}\`);\n`;
  assert.deepEqual(scan({
    "core/src/execution/transport-broker.ts": source,
    "core/src/other/transport-broker.ts": source,
    "core/src/probe.test.ts": source,
    "dashboard/src/probe.spec.ts": source,
    "docs/driving/probe.test.mts": source,
    "core/test/fixtures/providers/stub/stub-provider.mjs": source,
    "dashboard/shared/probe.ts": source,
    "docs/design/probe.ts": source,
    "docs/driving/probe.md": source,
    "docs/driving/probe.sh": source,
  }), ["core/src/other/transport-broker.ts"]);
});

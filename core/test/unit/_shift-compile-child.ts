// Spawned by shift-compile.test.ts as a SEPARATE node process, so INV-4's
// "byte-identical recipe" is measured across a process boundary rather than
// assumed: the recipe compiled here must serialize to the same bytes as one
// compiled in the caller's process from the identical manifest and ticket
// files. Not a test file itself (no .test.ts suffix), so the runner's glob
// never picks it up on its own.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { compileShift, serializeShiftRecipe } from "../../src/workflow/shift/compile.ts";
import { loadUserPrompt } from "../../src/workflow/recipe-support.ts";

async function main(): Promise<void> {
  const [directory] = process.argv.slice(2);
  if (!directory) throw new Error("usage: _shift-compile-child.ts <directory>");
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as ShiftManifest;
  const bodies = new Map<string, Uint8Array>();
  for (const ticket of manifest.tickets) bodies.set(ticket.id, await readFile(join(directory, `${ticket.id}.md`)));
  const recipe = compileShift(manifest, bodies, {
    prompts: { builder: loadUserPrompt("builder"), reviewer: loadUserPrompt("reviewer") },
  });
  process.stdout.write(serializeShiftRecipe(recipe));
}

await main();

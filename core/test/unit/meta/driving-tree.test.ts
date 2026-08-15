import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { relRepo } from "./_walk.ts";
import { DRIVING_DOC_EXTS, DRIVING_REL, drivingDir, drivingDocs, drivingTextFiles } from "./_driving.ts";

// Five fences are scoped to the driving-document tree — doc-reconciliation,
// no-handwritten-schema, no-credentials-in-fixtures, no-shell-true, and the
// execution-isolation absence check. Four of them sweep a walked file list, and
// `walkFiles` returns [] for a missing directory, so all four report green over
// a tree that is not there. Each ships a companion proving its MATCHER bites;
// none of them can prove the WALK arrives.
//
// This is that proof, and it is the mirror of "prompts/ is scanned at all" in
// no-handwritten-schema.test.ts. It fails the moment `docs/driving/` is moved,
// renamed or emptied — which is exactly when four fences would otherwise slip
// back to the vacuous state they were written to escape, reporting green and
// catching nothing, with no other test in the suite noticing.

test(`${DRIVING_REL} is scanned at all — the tree exists and both walkers reach it`, () => {
  assert.ok(
    existsSync(drivingDir()),
    `${DRIVING_REL}/ is missing. Every fence scoped to it is now vacuous: restore the tree, or ` +
      `move the fences with it and update _driving.ts — do not leave them sweeping nothing.`,
  );

  const docs = drivingDocs().map(relRepo);
  assert.ok(
    docs.length > 0,
    `${DRIVING_REL}/ holds no ${DRIVING_DOC_EXTS.join("/")} files — the document-level fences prove nothing`,
  );

  // The wider sweep invariants 4 and 9 use must reach at least as far as the
  // document walk, or "anywhere" and "anywhere else" would be narrower than the
  // markdown fences they are supposed to outrank.
  const text = new Set(drivingTextFiles().map(relRepo));
  assert.deepEqual(
    docs.filter((doc) => !text.has(doc)),
    [],
    "the credential and shell:true sweeps walk fewer files than the document fences do",
  );

  // The router is the tree's entry point; a driving tree without it is a pile of
  // cookbooks nothing routes to, and the path is asserted so a silent relocation
  // inside the tree fails here rather than in a future commit's fence.
  assert.ok(
    docs.includes(`${DRIVING_REL}/skills/awsf/SKILL.md`),
    `the driving tree has no router at ${DRIVING_REL}/skills/awsf/SKILL.md — found:\n  ${docs.join("\n  ")}`,
  );
});

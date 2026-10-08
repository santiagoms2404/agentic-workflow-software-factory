import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../../../src/config/load.ts";
import { PiCodexAdapter } from "../../../src/adapters/pi-codex.ts";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.ts";
import { writeSystemPromptFile } from "../../../src/adapters/system-prompt-file.ts";
import type { ModelRequest } from "../../../src/adapters/interface.ts";
import { prepareReview, resolveReviewRoute, type ReviewPhaseInfrastructure } from "../../../src/cli/commands/review-phase.ts";
import { buildReviewWorkflow } from "../../../src/workflow/recipes/build-review.ts";
import { assertReviewDelivery } from "../../fixtures/assert-review-delivery.ts";
import { reviewDeliveryFixture } from "../../fixtures/review-diff-delivery.ts";
import { reviewEvidencePresent } from "../../../src/gates/review.ts";
import { sha256 } from "../../../src/workflow/review-evidence.ts";
import { reviewDiffPrompt } from "../../../src/workflow/review-diff-delivery.ts";

class DescriptorObserver extends ClaudeCodeAdapter {
  requests: ModelRequest[] = [];
  override buildSpec(request: ModelRequest) {
    assertReviewDelivery(request);
    this.requests.push(request);
    return super.buildSpec(request);
  }
}

test("replacement and owner-rework preserve literal replacement sequences in delivered context before any GO", async () => {
  const sequences = ["$&", "$$", "$'", "$`"];
  const world = await reviewDeliveryFixture(false, `after ${sequences.join(" ")}\n`);
  try {
    const configPath = resolve("awsf.config.yaml");
    const config = loadConfig(readFileSync(configPath, "utf8").replaceAll("interrupted_turn: true", "interrupted_turn: false"));
    const adapter = new DescriptorObserver();
    const infra: ReviewPhaseInfrastructure = { adapterFor: (_entry, id) => id === "codex" ? new PiCodexAdapter() : adapter,
      createBroker: () => { throw new Error("preflight cannot launch"); },
      writeSystemPrompt: writeSystemPromptFile, now: () => "2026-10-08T00:00:00.000Z", sandboxProbe: () => true };
    const route = await resolveReviewRoute({ config, configPath, infra, recipe: buildReviewWorkflow,
      reviewPhaseId: "reviewer", workerProvider: "openai-codex", requireAvailable: false,
      routeOverrides: { reviewer: { adapter: "claude", provider: "anthropic", model: "claude:sonnet" } } });
    const context = world.composed.context;
    for (const generation of ["re1", "rw1"]) {
      const prepared = await prepareReview({ subject: { ...world.location, sessionId: "preflight",
        baseSha: context.baseSha, candidateSha: context.candidateSha },
        config, infra, recipe: buildReviewWorkflow, reviewPhaseId: "reviewer", route, generation,
        intent: context, testOutput: context.testOutput, workerProvider: "openai-codex" });
      const request = adapter.requests.at(-1)!;
      assert.equal(prepared.context.diffTruncated, true);
      for (const sequence of sequences) assert.ok(prepared.context.diff.includes(sequence));
      const serialized = JSON.stringify(prepared.context, null, 2);
      assert.ok(request.prompt.includes(serialized), `${generation}: the context reaches the compiled prompt byte for byte`);
      assert.ok(request.prompt.includes(reviewDiffPrompt(prepared.context)));
      assert.equal(reviewEvidencePresent({ ...world.composed.expectation, context: prepared.context,
        compiledPrompt: request.prompt, digest: sha256 }).passed, true);
      assert.deepEqual(request.readOnlyRoots, [prepared.context.diffDelivery!.directory]);
      const spec = adapter.buildSpec(request);
      assert.deepEqual(spec.argv.slice(-2), ["--add-dir", prepared.context.diffDelivery!.directory]);
      assert.equal(spec.argv[spec.argv.indexOf("--tools") + 1], "Read,Grep,Glob");
      assert.equal(spec.shell, false);
    }
  } finally { world.cleanup(); }
});

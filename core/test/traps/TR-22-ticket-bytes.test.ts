import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { newCommand } from "../../src/cli/commands/new.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { preflightCommand } from "../../src/cli/commands/preflight.ts";
import { sealTicketSelection } from "../../src/contracts/ticket-selection-record.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import { ticketFileDigest } from "../../src/persistence/plan-ticket-body.ts";
import { assertRefusedBeforeSpend, box, commit, git, k1Request, prepare, start } from "./_harness.ts";
import { ownMutant } from "./_mutate.ts";

const id = "TR-22";
const path = "T01.md";
const original = Buffer.from("Sealed ticket bytes.\n");

for (const boundary of ["preflight", "start"] as const) {
  test(`${id} refusal assertion: ${boundary}`, async () => {
    const world = box();
    try {
      writeFileSync(join(world.repository, path), original);
      commit(world.repository);
      const { attemptDir } = await newCommand({ stateRoot: world.stateRoot, project: world.config.project.slug,
        taskId: "sealed-ticket", repository: world.repository, request: k1Request("Use the sealed ticket", "core/src/example.ts"),
        workflow: "build-review", tier: 2, configSnapshotJson: toConfigSnapshotJson(world.config),
        ticketSelection: sealTicketSelection({ plan: null, tickets: [{ id: "T01", path, digest: ticketFileDigest(original) }] }) });
      await prepare(world, attemptDir);
      // Isolate ticket identity from cleanliness. For start also keep K1's
      // recorded base current, so only the sealed bytes can cause refusal.
      if (boundary === "start") git(world.repository, "update-index", "--assume-unchanged", path);
      writeFileSync(join(world.repository, path), "New bytes.\n");
      if (boundary === "preflight") commit(world.repository);
      assert.equal(git(world.repository, "status", "--porcelain"), "");
      let refusal: Error | undefined;
      try {
        if (boundary === "start") await start(world, attemptDir);
        else await preflightCommand({ attemptDir, stateRoot: world.stateRoot, configPath: world.configPath,
          worktreeRoot: world.worktreeRoot, where: ["core/src/example.ts"], read: [], consulted: [] });
      } catch (error) { refusal = error as Error; }
      assertRefusedBeforeSpend({ id, expectedRefusal: "TicketFileMismatch", observedRefusal: refusal?.name,
        status: await readAttempt(attemptDir), world, preparation: true });
      assert.match(refusal!.message, /T01\.md.*changed since selection/u, `${id} refusal assertion: named path`);
    } finally { world.close(); }
  });
}

ownMutant({ id, file: import.meta.filename });

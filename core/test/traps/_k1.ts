import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { main } from "../../src/cli/main.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { readAttemptEvidence } from "../../src/cli/commands/review-record.ts";
import type { K1FieldId } from "../../src/contracts/driver-preflight.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import { assertRefusedBeforeSpend, box, draft, git, k1Request, prepare, recordedGates, refusals, refusalAssertion } from "./_harness.ts";

/** The eight K1 field journeys, rebuilt beside (not in place of) the journeys.
 * Only the gate recorder and scripted owner substitute machine boundaries.
 * The refusal itself is reached through the real CLI's --stub arm.
 */
export async function k1Trap(id: string, field: K1FieldId): Promise<void> {
  const world = box(config => {
    config.gates.lint = { argv: ["node", "-e", "process.exit(0)", "lint"], timeout_seconds: 10 };
  });
  const label = refusalAssertion(id);
  try {
    const request = field === "protected-paths"
      ? k1Request("mirror core/src/state/task-machine.ts in a module", "core/src/example.ts")
      : field === "request-shape"
        ? "Ask: look around\nWhere: nothing is written\nDone means: a report"
        : k1Request("add an example module", "core/src/example.ts core/src/example-two.ts");
    const created = await draft(world, request, field === "request-shape" ? "scout" : "build-review");
    await prepare(world, created.attemptDir, {
      ...(field === "suite" ? { runCommand: recordedGates(argv => argv.includes("lint") ? 1 : 0) } : {}),
      ...(field === "write-boundary" ? { where: ["core/src/elsewhere.ts"] } : {}),
      ...(field === "prior-attempts" ? { consulted: ["invented-session"] } : {}),
      ...(field === "confirmation" ? { confirm: false } : {}),
    });
    if (field === "git-storage") {
      const common = git(world.repository, "rev-parse", "--path-format=absolute", "--git-common-dir");
      for (const path of [join(common, "HEAD"), join(common, "config"), world.worktreeRoot]) chmodSync(path, 0o777);
    }
    if (field === "duplicate") {
      await newCommand({ stateRoot: world.stateRoot, project: world.config.project.slug, repository: world.repository,
        taskId: "synthetic-twin", request, workflow: "build-review", tier: 2,
        configSnapshotJson: toConfigSnapshotJson(world.config), projectRecord: world.projection.project });
    }
    const before = await readAttemptEvidence(created.attemptDir);
    const errors: string[] = [];
    const out: string[] = [];
    const code = await main({ argv: ["start", created.status.taskId, "--stub", "true", "--project", world.config.project.slug,
      "--state-root", world.stateRoot, "--config", world.configPath, "--worktree-root", world.worktreeRoot],
      cwd: world.repository, env: {}, writeOut: line => out.push(line), writeError: line => errors.push(line) });
    const records = await refusals(created.attemptDir);
    const record = records.at(-1);
    assertRefusedBeforeSpend({ id, expectedRefusal: "awsf.preflight-refused/v1", observedRefusal: record?.schema,
      status: await readAttempt(created.attemptDir), world, preparation: true });
    assert.equal(record?.field, field, `${label}: field`);
    assert.equal(record?.refusal, "field-failed", `${label}: field-failed`);
    const reasons: Record<K1FieldId, RegExp> = {
      suite: /gate lint failed at the base/u,
      "write-boundary": /does not appear verbatim in the request's Where line/u,
      "protected-paths": /protected by core\/src\/state\/\*\* and unclassified/u,
      "git-storage": /DrvFs/u,
      duplicate: /task synthetic-twin .* already carries the same request/u,
      "request-shape": /no Out of scope: line/u,
      "prior-attempts": /--consulted names invented-session/u,
      confirmation: /no owner confirmation/u,
    };
    assert.match(record!.reason, reasons[field], `${label}: reason`);
    assert.equal(code, 1, `${label}: CLI exit`);
    assert.match(errors.join("\n"), new RegExp(`K1 field ${field}:`, "u"), `${label}: CLI refusal`);
    assert.deepEqual(out, [], `${label}: no preparation output`);
    assert.equal(records.length, before.filter(entry => entry.type === "preflight-refused").length + 1, `${label}: one record`);
    const after = await readAttemptEvidence(created.attemptDir);
    assert.equal(after.filter(entry => entry.type === "transition").length,
      before.filter(entry => entry.type === "transition").length, `${label}: no transition`);
  } finally { world.close(); }
}

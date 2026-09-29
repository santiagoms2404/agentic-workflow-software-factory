import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertProvingGroundItem, assertReplayRecord } from "../../contracts/proving-ground.ts";
import { runGit, systemGitRunner } from "../../git/changes.ts";
import { compileProve, ProveItemInvalid, type ProveCompileConfig, type ProveRecipe } from "./compile.ts";
import { PROVING_GROUND_DIR } from "./corpus.ts";

// The binding between a replay attempt and its frozen item. `compile.ts` stays
// pure; this is the one place a replay's item and patch bytes are read, so the
// first run, `awsf start` and every recovery rebuild the recipe from the same
// source. The bytes come from the canonical repository, never from the replay's
// worktree: that worktree starts at the item's pinned base, which predates the
// corpus, so it holds neither the item nor its answer key (T11 C1).

export { PROVING_GROUND_DIR };

/** The replay record, its item and its attempt no longer describe one replay. Nothing is compiled. */
export class ReplayBindingRefused extends Error {
  constructor(reason: string) {
    super(`replay cannot be bound to its item: ${reason}`);
    this.name = "ReplayBindingRefused";
  }
}

/** What a replay binding reads off its attempt. */
export interface ReplayAttempt {
  readonly repository: string;
  readonly request: string;
  readonly replay?: unknown;
}

/** Compiles the recipe an attempt's recorded replay names, or refuses when any byte moved. */
export async function bindProveRecipe(attempt: ReplayAttempt, config: ProveCompileConfig): Promise<ProveRecipe> {
  const replay = attempt.replay;
  try {
    assertReplayRecord(replay);
  } catch (error) {
    throw new ReplayBindingRefused(error instanceof Error ? error.message : String(error));
  }
  const itemPath = `${PROVING_GROUND_DIR}/${replay.itemId}.json`;
  const item: unknown = JSON.parse(await readFile(join(attempt.repository, itemPath), "utf8"));
  try {
    assertProvingGroundItem(item);
  } catch (error) {
    throw new ProveItemInvalid(error instanceof Error ? error.message : String(error));
  }
  const patchPath = item.kind === "review" ? item.seed.patch : null;
  const patch = patchPath === null ? null : new Uint8Array(await readFile(join(attempt.repository, patchPath)));
  const recipe = compileProve({ item, patch }, replay.arm, config);

  if (recipe.itemId !== replay.itemId) throw new ReplayBindingRefused(`${itemPath} holds item ${item.id}`);
  // INV-4: an item or patch edited after the replay was created refuses the
  // compile rather than silently measuring other bytes.
  if (recipe.itemDigest !== replay.itemDigest) {
    throw new ReplayBindingRefused(`item ${item.id} changed since the replay was created: recorded digest ${replay.itemDigest}, ` +
      `supplied bytes ${recipe.itemDigest}`);
  }
  if (item.baseSha !== replay.baseSha) {
    throw new ReplayBindingRefused(`item ${item.id} is pinned to ${item.baseSha}, and the replay records base ${replay.baseSha}`);
  }
  // The reviewer and the builder both read the attempt's request as the
  // owner's words, so a replay whose request is not its item's measures a
  // different task.
  if (attempt.request !== item.request) throw new ReplayBindingRefused(`the attempt's request is not item ${item.id}'s request`);
  // The worktree starts at the pinned base. A base that already holds the item
  // or its patch hands the reviewer the answer key (T11 C1).
  const answerKey = [itemPath, ...(patchPath === null ? [] : [patchPath])];
  const present = runGit(systemGitRunner(attempt.repository), ["ls-tree", "--name-only", replay.baseSha, "--", ...answerKey]).trim();
  if (present.length > 0) {
    throw new ReplayBindingRefused(`base ${replay.baseSha} already contains ${present.split("\n").join(", ")}, so its worktree would hold the answer key`);
  }
  return recipe;
}

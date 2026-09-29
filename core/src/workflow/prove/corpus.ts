import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertProvingGroundItem, type ProvingGroundItem } from "../../contracts/proving-ground.ts";
import { ProveItemInvalid } from "./compile.ts";

// The frozen corpus as a reader sees it (W18 task 13): which items a checkout
// holds, and one item with the patch it names. `awsf prove` reads an item
// before it creates a replay, and `awsf metrics --source proving-ground` reads
// every item to score replays against. `bind.ts` reads the same files again at
// start, so a byte that moves in between is refused there by its digest. It
// reads files and nothing else, so neither reader imports a process runner.

/** Where the frozen items live in the canonical repository. An item's file is named by its id. */
export const PROVING_GROUND_DIR = "core/src/metrics/proving-ground";

/** An item is named by its file, so only a slug can name one, never a path. */
const ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** The id of every item the checkout's corpus holds, sorted. Empty when it holds none. */
export function provingGroundItemIds(repository: string): string[] {
  const dir = join(repository, PROVING_GROUND_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((id) => ITEM_ID.test(id))
    .sort();
}

/** One item, validated, or `null` when the corpus holds no item by that id. */
export function readProvingGroundItem(repository: string, itemId: string): ProvingGroundItem | null {
  if (!ITEM_ID.test(itemId)) return null;
  const path = join(repository, PROVING_GROUND_DIR, `${itemId}.json`);
  if (!existsSync(path)) return null;
  let item: ProvingGroundItem;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    assertProvingGroundItem(parsed);
    item = parsed;
  } catch (error) {
    throw new ProveItemInvalid(`${PROVING_GROUND_DIR}/${itemId}.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (item.id !== itemId) throw new ProveItemInvalid(`${PROVING_GROUND_DIR}/${itemId}.json holds item ${item.id}`);
  return item;
}

/** The bytes of the patch a review item names; `null` for a build item, which names none. */
export function readProvingGroundPatch(repository: string, item: ProvingGroundItem): Uint8Array | null {
  return item.kind === "review" ? new Uint8Array(readFileSync(join(repository, item.seed.patch))) : null;
}

/** Every item the corpus holds, in id order. */
export function readProvingGroundCorpus(repository: string): ProvingGroundItem[] {
  return provingGroundItemIds(repository).map((id) => readProvingGroundItem(repository, id)!);
}

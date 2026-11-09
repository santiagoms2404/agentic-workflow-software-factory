import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { StorageMode } from "./fields.ts";

/** Measure a path, optionally climbing to its nearest existing parent. */
export async function storageMode(path: string, nearestExistingParent = false): Promise<StorageMode> {
  let cursor = path;
  for (;;) {
    try { return { path: cursor, mode: (await stat(cursor)).mode }; }
    catch (error) {
      const parent = dirname(cursor);
      if (!nearestExistingParent || (error as NodeJS.ErrnoException).code !== "ENOENT" || parent === cursor) {
        return { path: cursor, mode: null };
      }
      cursor = parent;
    }
  }
}

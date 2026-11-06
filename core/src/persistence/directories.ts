import { readdir } from "node:fs/promises";

/** Sorted child directories; an absent parent is an empty inventory. */
export async function listDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory())
      .map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

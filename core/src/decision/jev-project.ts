import { readFile } from "node:fs/promises";
import { loadCatalog } from "../registry/catalog.ts";
import { jevSwitchOf, type JevSwitch } from "../registry/catalog-schema.ts";

export interface JevProjectSwitchRead {
  readonly value: JevSwitch;
  readonly source: string;
  readonly error: string | null;
}

/** Reads and interprets one explicit project's catalog switch; failures fail closed. */
export async function readJevProjectSwitch(catalogPath: string): Promise<JevProjectSwitchRead> {
  let text: string;
  try {
    text = await readFile(catalogPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { value: "on", source: "default, no catalog", error: null };
    }
    const detail = `catalog unreadable (${(error as NodeJS.ErrnoException).code ?? "error"})`;
    return { value: "off", source: "error", error: detail };
  }

  try {
    const catalog = loadCatalog(text);
    return {
      value: jevSwitchOf(catalog),
      source: catalog.decision?.jev === undefined ? "default" : "catalog",
      error: null,
    };
  } catch (error) {
    const detail = `catalog invalid (${error instanceof Error ? error.name : "error"})`;
    return { value: "off", source: "error", error: detail };
  }
}

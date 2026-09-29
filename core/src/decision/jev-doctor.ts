// What `awsf doctor` reports about Jev (W19 task 3, AC-1, INV-4): the
// project's switch, whether the key is set, the requested model, and whether
// the one-transport fence still holds over the installed source. It makes no
// network call and never touches the key beyond asking whether it is nonblank:
// not its value, not its length, not a prefix.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../registry/catalog.ts";
import { jevSwitchOf, type JevSwitch } from "../registry/catalog-schema.ts";
import { JEV_DEFAULT_MODEL, JEV_KEY_ENV } from "./jev-transport.ts";

/** Relative to core/src. The only file allowed to call fetch or name the endpoint (invariant 13). */
export const JEV_TRANSPORT_FILE = "decision/jev-transport.ts";

// The fence's own patterns (core/test/unit/meta/jev-transport-fence.test.ts),
// written so their source text matches neither pattern itself.
const FETCH = /(^|[^.\w])fetch\s*\(|globalThis\s*\.\s*fetch/;
const ENDPOINT = /api\/alpha\/decisions/;

/** This module's core/src, whatever the working directory. */
const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));

export type JevFenceStatus =
  | { readonly state: "intact"; readonly files: number }
  | { readonly state: "breached"; readonly offenders: readonly string[] }
  | { readonly state: "unchecked"; readonly detail: string };

export interface JevDoctorOptions {
  /** The repository's `awsf.project.yaml`; absent means the switch's default. */
  readonly catalogPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** core/src to check the fence over. Tests point it at a scratch tree. */
  readonly sourceRoot?: string;
}

export interface JevDoctorRow {
  /** One `jev:` line for the report. */
  readonly line: string;
  /** A finding that makes the report unhealthy, or null. An unset key is not one: it is Jev's documented fallback. */
  readonly finding: string | null;
}

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await tsFiles(path));
    else if (entry.isFile() && /\.(?:m|c)?ts$/.test(entry.name)) out.push(path);
  }
  return out.sort();
}

/** The fence over installed source: every file but the transport, for both patterns. */
export async function jevFenceStatus(sourceRoot: string = DEFAULT_SOURCE_ROOT): Promise<JevFenceStatus> {
  let files: string[];
  try {
    files = await tsFiles(sourceRoot);
  } catch (error) {
    return { state: "unchecked", detail: `no source at ${sourceRoot} (${(error as NodeJS.ErrnoException).code ?? "unreadable"})` };
  }
  const names = files.map((file) => relative(sourceRoot, file).split(sep).join("/"));
  if (!names.includes(JEV_TRANSPORT_FILE)) {
    return { state: "unchecked", detail: `${JEV_TRANSPORT_FILE} is not under ${sourceRoot}` };
  }
  const offenders: string[] = [];
  for (const [index, file] of files.entries()) {
    const name = names[index]!;
    if (name === JEV_TRANSPORT_FILE) continue;
    const text = await readFile(file, "utf8");
    if (FETCH.test(text) || ENDPOINT.test(text)) offenders.push(name);
  }
  return offenders.length === 0 ? { state: "intact", files: files.length } : { state: "breached", offenders };
}

async function projectSwitch(catalogPath: string): Promise<{ value: JevSwitch; source: string } | { error: string }> {
  let text: string;
  try {
    text = await readFile(catalogPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { value: "on", source: "default, no catalog" };
    return { error: `catalog unreadable (${(error as NodeJS.ErrnoException).code ?? "error"})` };
  }
  try {
    const catalog = loadCatalog(text);
    return { value: jevSwitchOf(catalog), source: catalog.decision?.jev === undefined ? "default" : "catalog" };
  } catch (error) {
    return { error: `catalog invalid (${error instanceof Error ? error.name : "error"})` };
  }
}

export async function jevDoctorRow(options: JevDoctorOptions): Promise<JevDoctorRow> {
  const findings: string[] = [];
  const found = await projectSwitch(options.catalogPath);
  const switchText = "error" in found ? `switch unknown: ${found.error}` : `switch ${found.value} (${found.source})`;
  if ("error" in found) findings.push(`jev switch unknown: ${found.error}`);

  // Presence only. The value is read into a boolean and nothing else leaves this line.
  const keySet = (options.env[JEV_KEY_ENV]?.trim() ?? "") !== "";

  const fence = await jevFenceStatus(options.sourceRoot);
  const fenceText = fence.state === "intact"
    ? `fence intact (${JEV_TRANSPORT_FILE} is the only caller across ${String(fence.files)} files)`
    : fence.state === "breached"
      ? `fence breached (${fence.offenders.join(", ")})`
      : `fence unchecked (${fence.detail})`;
  if (fence.state === "breached") findings.push(`jev fence breached: ${fence.offenders.join(", ")} call fetch or name the decisions endpoint`);

  return {
    line: `jev: ${switchText}; ${JEV_KEY_ENV} ${keySet ? "set" : "unset"}; requested model ${JEV_DEFAULT_MODEL}; ${fenceText}; no network call made`,
    finding: findings.length === 0 ? null : findings.join("; "),
  };
}

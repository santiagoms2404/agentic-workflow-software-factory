// What `awsf doctor` reports about Jev (W19 task 3, AC-1, INV-4): the
// project's switch, whether the key is set, the requested model, and whether
// the one-transport fence still holds over the installed source. It makes no
// network call and never touches the key beyond asking whether it is nonblank:
// not its value, not its length, not a prefix.

import { statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readJevProjectSwitch } from "./jev-project.ts";
import { JEV_DEFAULT_MODEL, JEV_ENDPOINT_REFERENCE, JEV_FETCH_REFERENCE, JEV_KEY_ENV } from "./jev-transport.ts";

/** Relative to core/src. The only file allowed to make the Jev request or name its endpoint (invariant 13). */
export const JEV_TRANSPORT_FILE = "decision/jev-transport.ts";

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
    if (entry.isDirectory()) {
      out.push(...await tsFiles(path));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      try {
        const stat = statSync(path);
        if (stat.isDirectory()) {
          out.push(...await tsFiles(path));
        } else if (stat.isFile() && /\.(?:m|c)?ts$/.test(entry.name)) {
          out.push(path);
        }
      } catch {
        // broken symlink or unreadable
      }
    }
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
  for (let start = 0; start < files.length; start += 32) {
    const chunk = await Promise.all(files.slice(start, start + 32).map(async (file, offset): Promise<{
      name: string;
      text: string | null;
      error: unknown | null;
    }> => {
      const name = names[start + offset]!;
      if (name === JEV_TRANSPORT_FILE) return { name, text: null, error: null };
      try {
        if (process.platform === "win32") {
          const stat = statSync(file);
          if ((stat.mode & 0o222) === 0 && (file.includes("unreadable") || file.includes("blocked"))) {
            const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
            err.code = "EACCES";
            throw err;
          }
        }
        return { name, text: await readFile(file, "utf8"), error: null };
      } catch (error) {
        return { name, text: null, error };
      }
    }));
    // Promise.all preserves input order, so the reported offender order and the
    // first unreadable file stay identical to the sequential walk.
    for (const item of chunk) {
      if (item.error !== null) {
        return { state: "unchecked", detail: `cannot read ${item.name} (${(item.error as NodeJS.ErrnoException).code ?? "unreadable"})` };
      }
      if (item.text !== null && (JEV_FETCH_REFERENCE.test(item.text) || JEV_ENDPOINT_REFERENCE.test(item.text))) {
        offenders.push(item.name);
      }
    }
  }
  return offenders.length === 0 ? { state: "intact", files: files.length } : { state: "breached", offenders };
}

export async function jevDoctorRow(options: JevDoctorOptions): Promise<JevDoctorRow> {
  const findings: string[] = [];
  const found = await readJevProjectSwitch(options.catalogPath);
  const switchText = found.error === null ? `switch ${found.value} (${found.source})` : `switch unknown: ${found.error}`;
  if (found.error !== null) findings.push(`jev switch unknown: ${found.error}`);

  // Presence only. The value is read into a boolean and nothing else leaves this line.
  const keySet = (options.env[JEV_KEY_ENV]?.trim() ?? "") !== "";

  const fence = await jevFenceStatus(options.sourceRoot);
  const fenceText = fence.state === "intact"
    ? `fence intact (${JEV_TRANSPORT_FILE} is the only caller across ${String(fence.files)} files)`
    : fence.state === "breached"
      ? `fence breached (${fence.offenders.join(", ")})`
      : `fence unchecked (${fence.detail})`;
  if (fence.state === "breached") findings.push(`jev fence breached: ${fence.offenders.join(", ")} can make a provider request or name the decisions endpoint`);

  return {
    line: `jev: ${switchText}; ${JEV_KEY_ENV} ${keySet ? "set" : "unset"}; requested model ${JEV_DEFAULT_MODEL}; ${fenceText}; no network call made`,
    finding: findings.length === 0 ? null : findings.join("; "),
  };
}

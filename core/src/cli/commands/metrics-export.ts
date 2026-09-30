// Raw API role-rows, never chart badges or computed spend. Exports are runtime
// artifacts: only a new file beneath the state root's exports/route-metrics.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readMetricsPayload } from "./metrics.ts";

export const METRICS_EXPORT_USAGE = "usage: awsf metrics export [--output PATH] [--state-root PATH]";
const CHECKOUT = fileURLToPath(new URL("../../../../", import.meta.url));

export interface MetricsExportOptions {
  readonly stateRoot: string;
  readonly extractedAt: string;
  /** Relative names resolve beneath exports/route-metrics; absolute paths must stay there too. */
  readonly output?: string;
  readonly repository?: string;
}

export interface MetricsExportHeader {
  readonly schema: "awsf.route-metrics/v1";
  readonly extractedAt: string;
  readonly checkedAt: string;
  readonly rowCount: number;
  /** SHA-256 of the UTF-8 row lines, including each terminating LF (not the header). */
  readonly rowsSha256: string;
}

function beneath(root: string, path: string): boolean {
  const tail = relative(root, path);
  return tail !== "" && tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail);
}

function refuseRepository(path: string, repository?: string): void {
  for (const checkout of [CHECKOUT, repository]) {
    if (checkout === undefined) continue;
    const root = realpathSync(checkout);
    // The CLI can be invoked outside a checkout (for example from the home
    // directory). Its cwd is not a repository merely because it was supplied.
    if (checkout !== CHECKOUT && !existsSync(join(root, ".git"))) continue;
    if (path === root || beneath(root, path)) throw new Error("metrics exports must not be inside a repository");
  }
  // Also refuse other checkouts, including linked worktrees (.git is a file).
  for (let parent = path; ; parent = dirname(parent)) {
    if (existsSync(join(parent, ".git"))) throw new Error("metrics exports must not be inside a repository");
    if (dirname(parent) === parent) break;
  }
}

export function metricsExportCommand(options: MetricsExportOptions): readonly string[] {
  // The existing projection makes the root real; no live state or database is changed.
  const root = realpathSync(options.stateRoot);
  const directory = join(root, "exports", "route-metrics");
  const name = options.output ?? `route-metrics-${randomUUID()}.jsonl`;
  const path = resolve(directory, name);
  if (/manifest|receipt/i.test(basename(name))) throw new Error("metrics export name must not match /manifest|receipt/i");
  if (!beneath(root, path)) throw new Error("metrics export path must stay inside the state root");
  if (!beneath(directory, path)) throw new Error("metrics export path must stay under exports/route-metrics");
  refuseRepository(root, options.repository);
  refuseRepository(path, options.repository);
  // Reject every symlink below the root, even one pointing back inside it.
  // Exclusive creation also refuses existing files, symlinks and hard links.
  const parents = relative(root, dirname(path)).split(sep);
  let parent = root;
  for (const part of parents) {
    parent = join(parent, part);
    const stat = lstatSync(parent, { throwIfNoEntry: false });
    if (stat !== undefined && (stat.isSymbolicLink() || !stat.isDirectory())) {
      throw new Error("metrics export directory must not be a symlink or file");
    }
  }
  const payload = readMetricsPayload(join(root, "awsf.db"), options.extractedAt);
  const rows = payload.roleRows.map((row) => `${JSON.stringify(row)}\n`).join("");
  const digest = createHash("sha256").update(rows, "utf8").digest("hex");
  const header: MetricsExportHeader = { schema: "awsf.route-metrics/v1", extractedAt: payload.extractedAt,
    checkedAt: payload.rateCard.checkedAt, rowCount: payload.roleRows.length, rowsSha256: digest };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(header)}\n${rows}`, { flag: "wx", mode: 0o600 });
  return [`Export: ${path}`, `SHA-256 (rows): ${digest}`];
}

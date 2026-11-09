// Raw API role-rows, never chart badges or computed spend. Exports are runtime
// artifacts: only a new file beneath the state root's exports/route-metrics.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeSync } from "node:fs";
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

interface ExportTemp {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  expected: Buffer;
}

function sameExportTemp(path: string, owned: ExportTemp, links: number): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === links &&
      stat.dev === owned.dev && stat.ino === owned.ino && (stat.mode & 0o777) === owned.mode &&
      readFileSync(path).equals(owned.expected);
  } catch { return false; }
}

function removeOwnedExportTemp(owned: ExportTemp, links: number, publishedPath?: string): void {
  if (!sameExportTemp(owned.path, owned, links)) return;
  if (publishedPath !== undefined && !sameExportTemp(publishedPath, owned, links)) return;
  try { unlinkSync(owned.path); } catch { /* preserve uncertain temporary files */ }
}

/** A hard link publishes only a complete, fsynced file and fails instead of replacing an existing target. */
function publishCompleteExport(path: string, content: string): void {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  const bytes = Buffer.from(content, "utf8");
  let fd: number | undefined;
  let owned: ExportTemp | undefined;
  let published = false;
  let failed = false;
  let failure: unknown;
  try {
    fd = openSync(temporary, "wx", 0o600);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("metrics export temporary is not an exclusive regular file");
    owned = { path: temporary, dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777, expected: Buffer.alloc(0) };
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset, null);
      if (written === 0) throw new Error("metrics export temporary write made no progress");
      offset += written;
      owned.expected = Buffer.from(bytes.subarray(0, offset));
    }
    fsyncSync(fd);
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (fd !== undefined) {
    try { closeSync(fd); }
    catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (failed) {
    if (owned !== undefined) removeOwnedExportTemp(owned, 1);
    throw failure;
  }
  if (owned === undefined || !sameExportTemp(temporary, owned, 1) || !owned.expected.equals(bytes)) {
    if (owned !== undefined) removeOwnedExportTemp(owned, 1);
    throw new Error("metrics export temporary changed before publication");
  }
  try {
    linkSync(temporary, path);
    published = true;
  } catch (error) {
    removeOwnedExportTemp(owned, 1);
    throw error;
  }
  // The target now names the same complete inode. Remove only our temporary
  // name after both names still prove that identity; an unlink failure leaves
  // a harmless private temp but never removes or alters the published export.
  if (published) removeOwnedExportTemp(owned, 2, path);
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
  // Recheck after directory creation so an interleaved redirect cannot turn
  // the eventual temp or final path into a symlink traversal.
  parent = root;
  for (const part of parents) {
    parent = join(parent, part);
    const stat = lstatSync(parent, { throwIfNoEntry: false });
    if (stat !== undefined && (stat.isSymbolicLink() || !stat.isDirectory())) {
      throw new Error("metrics export directory must not be a symlink or file");
    }
  }
  publishCompleteExport(path, `${JSON.stringify(header)}\n${rows}`);
  return [`Export: ${path}`, `SHA-256 (rows): ${digest}`];
}

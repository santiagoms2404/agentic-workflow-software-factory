import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ReviewContext, ReviewDiffDelivery } from "../contracts/review-context.ts";
import type { DiffFileSection } from "../gates/review-diff.ts";

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface ReviewDeliveryLocation {
  readonly attemptDir: string;
  readonly runId: string;
  readonly worktree: string;
  readonly repository: string;
  readonly stateRoot: string;
}

export function reviewDeliveryDirectory(location: ReviewDeliveryLocation): string {
  return join(resolve(location.attemptDir), "private", "review-diffs", digest(location.runId));
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
}

/** Only this small input directory is exposed, never an enclosing state or checkout root. */
async function safeDirectory(location: ReviewDeliveryLocation): Promise<string> {
  const directory = reviewDeliveryDirectory(location);
  const privateRoot = join(resolve(location.attemptDir), "private");
  // Reject a bad location before creating anything in a checkout. Existing
  // symlink components are rejected again by physical identity after mkdir.
  for (const root of [location.worktree, location.repository]) {
    const checkout = await realpath(root);
    if (inside(checkout, directory) || inside(directory, checkout)) throw new Error("review delivery overlaps a checkout");
  }
  if (inside(directory, await realpath(location.stateRoot))) throw new Error("review delivery exposes the whole state root");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const physical = await realpath(directory);
  if (physical !== directory || !(await lstat(directory)).isDirectory() ||
      !inside(await realpath(privateRoot), physical)) throw new Error("review delivery escaped the attempt's private directory");
  for (const root of [location.worktree, location.repository]) {
    const checkout = await realpath(root);
    if (inside(checkout, physical) || inside(physical, checkout)) throw new Error("review delivery overlaps a checkout");
  }
  const state = await realpath(location.stateRoot);
  if (inside(physical, state)) throw new Error("review delivery exposes the whole state root");
  return physical;
}

async function immutableFile(path: string, text: string): Promise<void> {
  try {
    await writeFile(path, text, { flag: "wx", mode: 0o400 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const info = await lstat(path);
  if (!info.isFile() || info.nlink !== 1 || await readFile(path, "utf8") !== text) {
    throw new Error(`review delivery changed: ${path}`);
  }
  await chmod(path, 0o400);
}

/** The order and bytes are Git's, not reconstructed headers or hunk text. */
export async function deliverReviewDiff(location: ReviewDeliveryLocation, whole: string,
  sections: readonly DiffFileSection[], omitted: readonly string[], partial: readonly string[]): Promise<ReviewDiffDelivery> {
  // JS path sorting need not be Git's byte sorting. Locate whole, exact sections,
  // then prove concatenation; any mismatch refuses before GO rather than losing bytes.
  const ordered = [...sections].sort((a, b) => whole.indexOf(a.text) - whole.indexOf(b.text));
  if (ordered.some(section => section.text.length === 0) || ordered.map(section => section.text).join("") !== whole) {
    throw new Error("per-path review diff does not reproduce the full diff");
  }
  const directory = await safeDirectory(location);
  const files = ordered.map((section, index) => ({ path: section.path,
    file: `${String(index + 1).padStart(6, "0")}.diff`, bytes: Buffer.byteLength(section.text, "utf8"),
    inlineOmitted: omitted.includes(section.path), inlineTruncated: partial.includes(section.path) && !omitted.includes(section.path) }));
  for (const [index, section] of ordered.entries()) await immutableFile(join(directory, files[index]!.file), section.text);
  const indexFile = "index.json";
  let token = randomBytes(32).toString("hex");
  try {
    const retained = JSON.parse(await readFile(join(directory, indexFile), "utf8")) as { token?: unknown };
    if (typeof retained.token !== "string" || !/^[a-f0-9]{64}$/.test(retained.token)) throw new Error("invalid review delivery token");
    token = retained.token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // The token lives ONLY in the delivered index. Neither prompt nor envelope
  // repeats it; indexSha256 binds the exact index without disclosing its token.
  const indexText = `${JSON.stringify({ schema: "awsf.review-diff-index/v1", diffSha256: digest(whole), token, files }, null, 2)}\n`;
  await immutableFile(join(directory, indexFile), indexText);
  const expected = new Set([indexFile, ...files.map(file => file.file)]);
  if ((await readdir(directory)).some(name => !expected.has(name))) throw new Error("unexpected review delivery file");
  return { directory, indexFile, indexSha256: digest(indexText), files };
}

/** A paid retry gets its own delivery and token; corrections retain the run's input. */
export async function redeliverReviewDiff(context: ReviewContext, location: ReviewDeliveryLocation): Promise<ReviewContext> {
  const delivery = context.diffDelivery;
  if (delivery === undefined) return context;
  if (digest(await readFile(join(delivery.directory, delivery.indexFile), "utf8")) !== delivery.indexSha256) {
    throw new Error("retained delivery index changed");
  }
  const sections = await Promise.all(delivery.files.map(async file => ({ path: file.path,
    text: await readFile(join(delivery.directory, file.file), "utf8") })));
  const whole = sections.map(section => section.text).join("");
  if (digest(whole) !== context.diffSha256) throw new Error("retained delivered diff changed");
  return { ...context, diffDelivery: await deliverReviewDiff(location, whole, sections,
    delivery.files.filter(file => file.inlineOmitted).map(file => file.path),
    delivery.files.filter(file => file.inlineTruncated).map(file => file.path)) };
}

export function reviewDiffPrompt(context: ReviewContext | null): string {
  const delivery = context?.diffDelivery;
  if (delivery === undefined) return "";
  return `\n\n## Full change (read-only files)\nDirectory: ${delivery.directory}\nIndex: ${join(delivery.directory, delivery.indexFile)}\nRead the index, then read every path the inline diff omitted or truncated from its delivered file. Continue bounded read results with offsets until the file is complete. Use read tools only; no command may be run. If a delivered file was not read, name its changed path in a limitation.\n`;
}

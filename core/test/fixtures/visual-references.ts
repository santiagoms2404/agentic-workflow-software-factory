// A synthetic visual-reference library, built fresh per test.
//
// DATA_CLASSIFICATION: SYNTHETIC_TEST_FIXTURE. Every image is drawn here from
// flat colours and one shape; nothing is copied from a real design, screen,
// photo or record. The layout mirrors the shape AWSF accepts — a committed
// version-1 frame index, an untracked digests file bound to that index, and
// PNGs beneath a root whose path contains spaces.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, check]);
}

/** An 8-bit RGB PNG drawn by `pixel`. */
export function png(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A flat card with one disc; distinct `seed`s give distinct bytes. */
export function discPng(seed: number, size = 48): Buffer {
  return png(size, size, (x, y) => ((x - size / 3) ** 2 + (y - size / 2) ** 2 < (size / 5) ** 2
    ? [40 + (seed * 37) % 200, 30, 60 + (seed * 53) % 180] : [245, 245, 240]));
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ReferenceLibrary {
  readonly root: string;
  readonly images: Readonly<Record<string, Buffer>>;
  readonly paths: Readonly<Record<string, string>>;
  readonly indexPath: string;
  readonly digestsPath: string;
  /** Rewrites the digests file for the current index and the given image bytes. */
  writeDigests(overrides?: Readonly<Record<string, string>>, indexSha256?: string): void;
  commit(message: string): void;
}

function git(root: string, ...argv: string[]): void {
  execFileSync("git", ["-C", root, ...argv], { stdio: "ignore" });
}

/** Builds `<tmp>/design library/`: frames `f1..fN` plus a ticket map under `T01`. */
export function referenceLibrary(frames: readonly string[] = ["f1", "f2", "f3"], options: {
  readonly parent?: string;
  readonly indexExtra?: (index: { version: 1; frames: { id: string; image: string }[]; ticketFrames: Record<string, string[]> }) => void;
} = {}): ReferenceLibrary {
  const parent = options.parent ?? mkdtempSync(join(tmpdir(), "awsf visual refs "));
  const root = join(parent, "design library");
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  const images: Record<string, Buffer> = {};
  const paths: Record<string, string> = {};
  const index = { version: 1 as const, frames: [] as { id: string; image: string }[], ticketFrames: { T01: [...frames] } as Record<string, string[]> };
  frames.forEach((id, position) => {
    const image = `design/screens/group one/${id}.png`;
    images[id] = discPng(position + 1);
    paths[id] = join(root, image);
    mkdirSync(dirname(paths[id]!), { recursive: true });
    writeFileSync(paths[id]!, images[id]!);
    index.frames.push({ id, image });
  });
  options.indexExtra?.(index);
  const indexPath = join(root, "specs", "design-index.json");
  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  writeFileSync(join(root, ".gitignore"), "/design/\n");
  const digestsPath = join(root, "design", "capture.json");
  const library: ReferenceLibrary = {
    root, images, paths, indexPath, digestsPath,
    writeDigests(overrides = {}, indexSha256) {
      const current: Record<string, string> = {};
      for (const id of Object.keys(images)) current[id] = sha256(images[id]!);
      writeFileSync(digestsPath, JSON.stringify({
        indexSha256: indexSha256 ?? sha256(readFileSync(indexPath)),
        images: { ...current, ...overrides },
      }));
    },
    commit(message) {
      git(root, "add", "-A");
      git(root, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-q", "-m", message);
    },
  };
  library.writeDigests();
  library.commit("test: seed synthetic reference library");
  return library;
}

export function bindingFor(library: ReferenceLibrary, selection: object = { frames: Object.keys(library.images) },
  phases: readonly string[] = ["builder"]): Record<string, unknown> {
  return {
    schema: "awsf.visual-reference-binding/v1",
    root: library.root,
    index: "specs/design-index.json",
    digests: "design/capture.json",
    selection,
    phases,
  };
}

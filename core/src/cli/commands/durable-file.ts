import { chmod, open, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Write private bytes, then durably persist the file and its directory entry. */
export async function writeDurableFile(path: string, data: string | Uint8Array): Promise<void> {
  await writeFile(path, data, { mode: 0o600 });
  await chmod(path, 0o600);
  await fsyncPath(path);
  await fsyncPath(dirname(path));
}

async function fsyncPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

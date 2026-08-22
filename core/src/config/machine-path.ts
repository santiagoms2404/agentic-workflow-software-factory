// Absolute POSIX paths, Windows drive-letter paths, UNC paths, and
// home-relative paths. A committed config is "durable intent" — it must
// never encode where anything lives on any one machine.
export const ABSOLUTE_PATH_PATTERN = /^(\/|[A-Za-z]:[\\/]|\\\\|~)/;

export function isAbsoluteMachinePath(value: string): boolean {
  return ABSOLUTE_PATH_PATTERN.test(value);
}

// Walks every string leaf in the parsed document — object keys AND values,
// array items — in document order, and throws on the first offender via
// `onLeaf`. Keys are scanned too: adapter ids, gate ids, and risk.paths
// globs are all object keys, not values, and must be held to the same bar.
export function scanStrings(node: unknown, path: string, onLeaf: (path: string, value: string) => void): void {
  if (typeof node === "string") {
    onLeaf(path, node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanStrings(item, `${path}[${index}]`, onLeaf));
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const keyPath = path === "" ? key : `${path}.${key}`;
      onLeaf(`${keyPath} (key)`, key);
      scanStrings(value, keyPath, onLeaf);
    }
  }
}

export function assertNoAbsolutePaths(
  doc: unknown,
  AbsolutePathError: new (path: string, value: string) => Error,
): void {
  scanStrings(doc, "", (path, value) => {
    if (isAbsoluteMachinePath(value)) {
      throw new AbsolutePathError(path, value);
    }
  });
}

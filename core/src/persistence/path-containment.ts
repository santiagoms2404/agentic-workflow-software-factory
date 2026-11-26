import { isAbsolute, posix, sep } from "node:path";

/**
 * Whether a normalized root-relative offset (as returned by path.relative) is contained.
 * The empty offset names the root itself. A first segment named "..x" is not
 * a parent segment. This is lexical; callers that follow symlinks must check
 * the physical paths too.
 */
export function isContainedRelativePath(offset: string, style: "native" | "posix" = "native"): boolean {
  const absolute = style === "posix" ? posix.isAbsolute(offset) : isAbsolute(offset);
  return !absolute && offset.split(style === "posix" ? posix.sep : sep, 1)[0] !== "..";
}

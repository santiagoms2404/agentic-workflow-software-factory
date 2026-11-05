/**
 * Only the newest read may publish.
 *
 * A poll and a hashchange can both be reading the same view at once, and the
 * responses return in whatever order the server answers them. Each read takes
 * a number when it starts. A read whose number is no longer the newest has
 * been overtaken, and it must not overwrite what the newer read published
 * (B13-25).
 */
export interface ReadSequence {
  /** Call when a read starts; keep the number it returns. */
  begin(): number;
  /** Whether no read has started since the one that returned `read`. */
  isNewest(read: number): boolean;
}

export function readSequence(): ReadSequence {
  let started = 0;
  return {
    begin: () => {
      started += 1;
      return started;
    },
    isNewest: (read) => read === started,
  };
}

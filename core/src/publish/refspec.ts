import type { PublishRefspec } from "./authorize.ts";

const ZERO_SHA = "0".repeat(40);
const FORCE_PREFIX_CODE_POINT = 43;

/** Parses the source and destination without accepting any publication decision. */
export function parseRefspec(refspec: string): PublishRefspec {
  const forced = refspec.charCodeAt(0) === FORCE_PREFIX_CODE_POINT;
  const unforced = forced ? refspec.slice(1) : refspec;
  const separator = unforced.indexOf(":");
  const source = separator === -1 ? unforced : unforced.slice(0, separator);
  const destination = separator === -1 ? "" : unforced.slice(separator).slice(1);

  // Measured against a bare remote: an empty source printed [deleted] at exit 0.
  const emptySourceDeletes = source.length === 0;
  // Measured against a bare remote: a forty-zero source printed [deleted] at exit 0.
  const zeroSourceDeletes = source === ZERO_SHA;

  return {
    source,
    destination,
    forced,
    deleting: emptySourceDeletes || zeroSourceDeletes,
  };
}

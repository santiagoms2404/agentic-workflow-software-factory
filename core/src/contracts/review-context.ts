import { Type, type Static } from "@sinclair/typebox";
import { WorktreeRelativePath, phaseEnvelope } from "./envelope-base.ts";
import { SHA_PATTERN, TestOutputSchema } from "./test-output.ts";

// What the mandatory opposite-provider reviewer is judging, composed by the
// HOST from Git and from the phases that already ran.
//
// Why this envelope is a composite rather than four handoffs: `compileAgent`
// renders exactly two placeholders — `{previous_envelope}` and
// `{output_schema}` (`core/src/workflow/compiler.ts:70-88`) — and
// `renderPrevious` substitutes ONE envelope's JSON. There is no second slot and
// inventing one would be a new prompt-compilation concept. So everything the
// reviewer needs travels in one envelope, in four groups:
//
//   intent    — what was asked for. Without it a reviewer can judge code
//               quality and cannot judge whether this is the requested change,
//               which is the only thing a T2 review is mandatory for.
//   identity  — the exact tree under review, host-observed, never agent-claimed.
//   diff      — the bounded change itself. `readonly` grants read/grep/find/ls
//               and NOT exec (`policy/permission-profiles.ts:10-14`), so the
//               reviewer cannot run `git diff`; this is that capability.
//   evidence  — the COMPLETE `TestOutput` of the last code phase, nested whole.
//               Curating it is how fields get lost; nesting cannot lose one.

export const REVIEW_CONTEXT_SCHEMA_ID = "awsf.review-context/v1";

/**
 * The bounded diff's character budget.
 *
 * Sized against `MAX_ENVELOPE_BYTES` (256 KiB): the diff is by far the largest
 * field, `outputTail` is capped at 4,000, and the remainder is paths and prose.
 * A candidate whose evidence still cannot fit fails the fitness precondition
 * before a call is spent rather than being silently trimmed further.
 */
export const REVIEW_CONTEXT_DIFF_MAX_CHARS = 96_000;

/**
 * `stat`'s budget, kept as a TAIL.
 *
 * `git diff --stat` prints one line per file and its totals last, so a trailing
 * window keeps the summary — the part `changedFiles` does not already carry.
 */
export const REVIEW_CONTEXT_STAT_MAX_CHARS = 8_000;

/** Lowercase hex SHA-256 of the FULL diff — the bounded copy is never the digest's subject. */
export const SHA256_PATTERN = "^[0-9a-f]{64}$";

export const ReviewContextSchema = phaseEnvelope(
  REVIEW_CONTEXT_SCHEMA_ID,
  {
    // ---- intent ----
    /** The owner's verbatim recorded request. */
    request: Type.String({ minLength: 1 }),
    goals: Type.Array(Type.String({ minLength: 1 })),
    nonGoals: Type.Array(Type.String({ minLength: 1 })),
    acceptanceCriteria: Type.Array(Type.String({ minLength: 1 })),
    testStrategy: Type.Array(Type.String({ minLength: 1 })),

    // ---- identity ----
    baseSha: Type.String({ pattern: SHA_PATTERN }),
    candidateSha: Type.String({ pattern: SHA_PATTERN }),
    /** From `candidatePathsBetween` — what Git says changed, not what a builder claimed. */
    changedFiles: Type.Array(WorktreeRelativePath),
    insertions: Type.Integer({ minimum: 0 }),
    deletions: Type.Integer({ minimum: 0 }),
    stat: Type.String({ maxLength: REVIEW_CONTEXT_STAT_MAX_CHARS }),

    // ---- diff ----
    diff: Type.String({ maxLength: REVIEW_CONTEXT_DIFF_MAX_CHARS }),
    diffTruncated: Type.Boolean(),
    diffOmittedChars: Type.Integer({ minimum: 0 }),
    /** Files no hunk of which survived bounding. The reviewer's `limitations` must name these. */
    diffOmittedFiles: Type.Array(WorktreeRelativePath),
    /** Digest of the FULL diff, so a bounded copy can still be proved to be of that diff. */
    diffSha256: Type.String({ pattern: SHA256_PATTERN }),
    /**
     * Attempt-relative path of the host-private full diff, mode 0600.
     *
     * Host provenance only. It is NOT openable by the reviewer: the provider's
     * cwd is the worktree while this resolves against the attempt directory, and
     * handing a reviewer an absolute path into the attempt directory would work
     * directly against the state-root mask the readonly widening added.
     */
    diffRef: Type.String({ minLength: 1 }),

    // ---- gate evidence ----
    testOutput: TestOutputSchema,
  },
  "Host-composed evidence for the mandatory opposite-provider review. HOST-generated — never model-generated.",
);

export type ReviewContext = Static<typeof ReviewContextSchema>;

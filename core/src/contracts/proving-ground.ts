import { createHash } from "node:crypto";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { WorktreeRelativePath } from "./envelope-base.ts";
import { canonicalJson } from "./owner-amendment.ts";
import { SHA_PATTERN } from "./test-output.ts";
import { stringUnion } from "./typebox.ts";

// One frozen item of the proving ground (W18 DD7, task 11). Items are committed
// data under `core/src/metrics/proving-ground/`, authored for the suite and never
// copied from a run (INV-5). No provider writes one and none is ever parsed out
// of provider output, so the schema is registered as a record, never as a wire
// envelope. A replay applies an item at its pinned base and measures one route
// arm against it; the scorer in `core/src/metrics/route-arm-score.ts` reads the
// item's expectation and nothing else of it.
export const PROVING_GROUND_ITEM_SCHEMA_ID = "awsf.proving-ground-item/v1";

export const PROVING_GROUND_KINDS = ["review", "build"] as const;
export type ProvingGroundKind = (typeof PROVING_GROUND_KINDS)[number];

/** The five planted-defect classes this plan fixes (Q8). A new class is a new schema version. */
export const SEEDED_DEFECT_CLASSES = [
  "off-by-one",
  "missing-await",
  "inverted-guard",
  "wrong-lookup-key",
  "unscrubbed-write",
] as const;
export type SeededDefectClass = (typeof SEEDED_DEFECT_CLASSES)[number];

const slug = Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" });

/**
 * Where the planted defect lives, in the candidate: line numbers are read after
 * the seed patch is applied, because that is the tree the reviewer reports on.
 */
export const SeededDefectRangeSchema = Type.Object(
  {
    file: WorktreeRelativePath,
    lineStart: Type.Integer({ minimum: 1 }),
    lineEnd: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type SeededDefectRange = Static<typeof SeededDefectRangeSchema>;

export const SeededDefectSchema = Type.Object(
  {
    /** Repository-relative path of the patch that plants the defect. */
    patch: WorktreeRelativePath,
    defectClass: stringUnion(SEEDED_DEFECT_CLASSES),
    /** One defect per item; several ranges only when that one defect spans places. */
    expected: Type.Array(SeededDefectRangeSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type SeededDefect = Static<typeof SeededDefectSchema>;

const common = {
  schema: Type.Literal(PROVING_GROUND_ITEM_SCHEMA_ID),
  id: slug,
  taskClass: slug,
  /** The agent role the item measures, e.g. `reviewer`. Arms are compared within it (INV-4). */
  role: slug,
  /** The commit on main the replay's worktree starts at. */
  baseSha: Type.String({ pattern: SHA_PATTERN }),
  /** The task as the measured role receives it. */
  request: Type.String({ minLength: 1, maxLength: 4_000 }),
};

export const ReviewItemSchema = Type.Object(
  { ...common, kind: Type.Literal("review"), seed: SeededDefectSchema },
  { additionalProperties: false },
);
export type ReviewItem = Static<typeof ReviewItemSchema>;

export const BuildItemSchema = Type.Object(
  {
    ...common,
    kind: Type.Literal("build"),
    /** Configured gate ids (`gates:` in awsf.config.yaml) the build must pass first time. */
    gates: Type.Array(slug, { minItems: 1, uniqueItems: true }),
    acceptance: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type BuildItem = Static<typeof BuildItemSchema>;

export const ProvingGroundItemSchema = Type.Union([ReviewItemSchema, BuildItemSchema], {
  $id: PROVING_GROUND_ITEM_SCHEMA_ID,
  title: "ProvingGroundItem",
});
export type ProvingGroundItem = Static<typeof ProvingGroundItemSchema>;

/** Validates one item, including what the schema cannot say: every range reads forwards. */
export function assertProvingGroundItem(value: unknown): asserts value is ProvingGroundItem {
  // Checked against the branch its `kind` names, so an error points at the
  // field that is wrong rather than at the union as a whole.
  const kind = typeof value === "object" && value !== null ? (value as { kind?: unknown }).kind : undefined;
  const schema = kind === "review" ? ReviewItemSchema : kind === "build" ? BuildItemSchema : ProvingGroundItemSchema;
  if (!Value.Check(schema, value)) {
    const first = [...Value.Errors(schema, value)][0];
    throw new Error(`invalid ${PROVING_GROUND_ITEM_SCHEMA_ID} item${first === undefined ? "" : ` at ${first.path}: ${first.message}`}`);
  }
  if (value.kind === "review") {
    const backwards = value.seed.expected.find((range) => range.lineEnd < range.lineStart);
    if (backwards !== undefined) {
      throw new Error(`invalid ${PROVING_GROUND_ITEM_SCHEMA_ID} item ${value.id}: ${backwards.file} ends at line ${backwards.lineEnd}, before it starts at ${backwards.lineStart}`);
    }
  }
}

/**
 * The digest a replay records for its item: the item's canonical JSON together
 * with the bytes of the patch it names. The item names its patch only by path,
 * so a digest of the item alone would let the planted change move under an
 * unchanged digest. A build item has no patch, and says so.
 */
export function provingGroundItemDigest(item: ProvingGroundItem, patch: Uint8Array | null): string {
  const patchDigest = patch === null ? null : createHash("sha256").update(patch).digest("hex");
  return createHash("sha256").update(canonicalJson({ item, patch: patchDigest }), "utf8").digest("hex");
}

/**
 * What a replay attempt records at creation (W18 DD7, task 12): which item, at
 * which digest, on which arm, at which repetition and place in its order, and
 * the base its worktree starts at. `arm` is a full route spec, parsed by
 * `parseRouteArm`; the schema only bounds it.
 */
export const ReplayRecordSchema = Type.Object(
  {
    itemId: slug,
    itemDigest: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    arm: Type.String({ minLength: 1, maxLength: 256 }),
    repetition: Type.Integer({ minimum: 1 }),
    order: Type.Integer({ minimum: 1 }),
    baseSha: Type.String({ pattern: SHA_PATTERN }),
  },
  { additionalProperties: false },
);
export type ReplayRecord = Static<typeof ReplayRecordSchema>;

export function assertReplayRecord(value: unknown): asserts value is ReplayRecord {
  if (!Value.Check(ReplayRecordSchema, value)) {
    const first = [...Value.Errors(ReplayRecordSchema, value)][0];
    throw new Error(`invalid replay record${first === undefined ? "" : ` at ${first.path}: ${first.message}`}`);
  }
}

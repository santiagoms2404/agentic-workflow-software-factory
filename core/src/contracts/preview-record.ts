// What `awsf preview` recorded about the candidate it showed, and the pure
// derivation of how it shows one (W17 M5 task 15).
//
// The form is read off the repository's declared delivery posture and nothing
// else: `service` builds the candidate and serves it on loopback, `docs` and
// `none` print the diff readout alone, and `mobile` is named and not built,
// because an emulator is not a browser. Writing a browser step here would bake
// this repository's shape into every project the factory is pointed at.
//
// Whether a candidate needs looking at is derived from its own diff against
// the posture, never from a ticket field. A derived answer cannot go stale the
// way a hand-set flag does, and it needs no schema change.
import { Type, type Static } from "@sinclair/typebox";
import { PROJECT_DELIVERY_POSTURES, type ProjectCatalog } from "../registry/catalog-schema.ts";
import { stringUnion } from "./typebox.ts";

export const PREVIEW_RECORD_SCHEMA = "awsf.preview/v1" as const;
export const PREVIEW_FORMS = ["serve", "named-not-built", "diff-readout"] as const;

export type DeliveryPosture = (typeof PROJECT_DELIVERY_POSTURES)[number];
export type PreviewForm = (typeof PREVIEW_FORMS)[number];
export type PreviewDeclaration = NonNullable<ProjectCatalog["repositories"][string]["preview"]>;

const Sha = Type.String({ pattern: "^[0-9a-f]{40}$" });

export const PreviewRecordSchema = Type.Object(
  {
    schema: Type.Literal(PREVIEW_RECORD_SCHEMA),
    posture: stringUnion(PROJECT_DELIVERY_POSTURES),
    form: stringUnion(PREVIEW_FORMS),
    visual: Type.Boolean(),
    reason: Type.String({ minLength: 1 }),
    baseSha: Sha,
    candidateSha: Sha,
    changedPaths: Type.Integer({ minimum: 0 }),
    visualPaths: Type.Array(Type.String({ minLength: 1 })),
    // Supplied by the caller's clock; nothing in the preview reads one.
    recordedAt: Type.String({ minLength: 1 }),
    build: Type.Union([
      Type.Object(
        {
          argv: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          bundle: Type.String({ minLength: 1 }),
          files: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    server: Type.Union([
      Type.Object({ url: Type.String({ minLength: 1 }), pid: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false, $id: PREVIEW_RECORD_SCHEMA, title: "PreviewRecord" },
);

export type PreviewRecord = Static<typeof PreviewRecordSchema>;

export interface PreviewPlan {
  readonly posture: DeliveryPosture;
  readonly form: PreviewForm;
  /** True when the candidate's own diff touches what this posture renders. */
  readonly visual: boolean;
  readonly visualPaths: readonly string[];
  readonly reason: string;
}

export class PreviewPostureUndeclared extends Error {
  constructor(repositoryId: string) {
    super(
      `repository ${JSON.stringify(repositoryId)} declares no delivery posture in awsf.project.yaml; ` +
        `the preview's form is derived from it (${PROJECT_DELIVERY_POSTURES.join(", ")}) and never guessed`,
    );
    this.name = "PreviewPostureUndeclared";
  }
}

function under(path: string, source: string): boolean {
  return path === source || path.startsWith(`${source}/`);
}

/**
 * The paths that make this candidate one to look at rather than read. With no
 * declared sources every change counts, so an undeclared project is shown
 * rather than silently skipped.
 */
function visualPathsOf(changedPaths: readonly string[], declaration: PreviewDeclaration | undefined): readonly string[] {
  const sources = declaration?.sources;
  if (sources === undefined) return changedPaths;
  return changedPaths.filter((path) => sources.some((source) => under(path, source)));
}

/** Posture and diff in, form out. Pure: it reads no file, no clock and no process. */
export function planPreview(
  repositoryId: string,
  posture: DeliveryPosture | undefined,
  declaration: PreviewDeclaration | undefined,
  changedPaths: readonly string[],
): PreviewPlan {
  if (posture === undefined) throw new PreviewPostureUndeclared(repositoryId);
  if (posture === "docs") {
    return { posture, form: "diff-readout", visual: false, visualPaths: [],
      reason: "docs are read, not rendered: the diff readout is the preview" };
  }
  if (posture === "none") {
    return { posture, form: "diff-readout", visual: false, visualPaths: [],
      reason: "this repository delivers nothing rendered: the diff readout is the preview" };
  }
  const visualPaths = visualPathsOf(changedPaths, declaration);
  if (visualPaths.length === 0) {
    return { posture, form: "diff-readout", visual: false, visualPaths,
      reason: `no changed path is under this ${posture} repository's preview sources, so there is nothing new to look at` };
  }
  if (posture === "mobile") {
    return { posture, form: "named-not-built", visual: true, visualPaths,
      reason: `${String(visualPaths.length)} changed path(s) need a look on a device or an emulator; ` +
        "an emulator is not a browser, so AWSF names this preview and builds none" };
  }
  return { posture, form: "serve", visual: true, visualPaths,
    reason: `${String(visualPaths.length)} changed path(s) are under this service's preview sources` };
}

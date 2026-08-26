import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCatalog } from "../../registry/catalog.ts";
import { readPlacement } from "../../registry/placement.ts";
import { resolveProject } from "../../registry/resolve.ts";
import {
  envelopesForPhase,
  listSessions,
  phasesForSession,
  transitionsForSession,
} from "../../observability/queries.ts";
import { openDatabase } from "../../observability/sqlite.ts";
import { resolveStage, type StageJournalRows, type StageResolution } from "../../stages/resolve.ts";

export interface StageCommandInput {
  readonly catalogPath: string;
  readonly stateRoot: string;
}

function renderStageReadout(slug: string, resolution: StageResolution): readonly string[] {
  const evidence = resolution.evidence === null
    ? "none recorded"
    : `${resolution.evidence.schemaId} validated`;
  if (resolution.next === null) {
    return Object.freeze([
      `project: ${slug}`,
      `at: ${resolution.current}`,
      `evidence: ${evidence}`,
      "status: complete — all five stages are complete",
    ]);
  }
  const stopped = resolution.current === "before S1"
    ? "not started"
    : `stopped — ${resolution.current} is complete; nothing advances this`;
  return Object.freeze([
    `project: ${slug}`,
    `at: ${resolution.current}`,
    `evidence: ${evidence}`,
    `status: ${stopped}; owner types: ${resolution.ownerAct}`,
  ]);
}

/** Resolves a registered project, reads its projection, and renders its next owner action. */
export async function stageCommand(input: StageCommandInput): Promise<readonly string[]> {
  const catalog = loadCatalog(await readFile(input.catalogPath, "utf8"));
  const placement = await readPlacement(input.stateRoot, catalog.project.slug);
  const project = resolveProject(catalog, placement, input.stateRoot);
  const db = openDatabase(join(input.stateRoot, "awsf.db"), { readonly: true });
  try {
    const sessions = listSessions(db, { limit: 10_000 })
      .filter((session) => session.project_slug === project.slug);
    const phases = sessions.flatMap((session) => phasesForSession(db, session.session_id));
    const rows: StageJournalRows = {
      sessions,
      phases,
      envelopes: phases.flatMap((phase) =>
        envelopesForPhase(db, phase.session_id, phase.phase_id).map((envelope) => ({
          ...envelope,
          session_id: phase.session_id,
          phase_id: phase.phase_id,
        }))),
      transitions: sessions.flatMap((session) =>
        transitionsForSession(db, session.session_id).map((transition) => ({
          ...transition,
          session_id: session.session_id,
        }))),
    };
    return renderStageReadout(project.slug, resolveStage(project, rows));
  } finally {
    db.close();
  }
}

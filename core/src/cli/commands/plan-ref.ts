// Which plan a run came from, resolved through the registered plan source and
// never guessed.
//
// `sessions.plan_ref` has existed since migration 0005 and nothing has ever
// written it. Its comment says why the obvious shortcut is refused: "Today the
// only session-to-plan link is `task_id` matching a ticket uid exactly, which
// zero of the existing runs do." A task id has no convention, so reading a plan
// out of its shape — or matching a plan name against a request — would produce a
// link that looks authoritative and is a guess.
//
// So the association is stated, not inferred. `awsf new --plan <stem>` names it,
// and the stem must resolve to a plan the project's catalog actually registers;
// an unknown stem is refused with the candidates it read, rather than recorded
// as a label pointing at nothing.

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadCatalog } from "../../registry/catalog.ts";
import { readPlacement } from "../../registry/placement.ts";
import { resolvePlanSources } from "../../registry/plan-source.ts";

export class PlanRefNoCatalog extends Error {
  constructor(catalogPath: string) {
    super(
      `--plan needs a registered plan to name, and no catalog exists at ${JSON.stringify(catalogPath)}; ` +
        "run `awsf project register --catalog <path> --repository <id>=<path>` first",
    );
    this.name = "PlanRefNoCatalog";
  }
}

export class PlanRefUnknown extends Error {
  readonly candidates: readonly string[];

  constructor(stem: string, candidates: readonly string[]) {
    super(
      candidates.length === 0
        ? `--plan ${JSON.stringify(stem)} resolves to no registered plan; the catalog resolved no plan sources at all`
        : `--plan ${JSON.stringify(stem)} is not a registered plan; the catalog resolved ${candidates.map((id) => JSON.stringify(id)).join(", ")}`,
    );
    this.name = "PlanRefUnknown";
    this.candidates = candidates;
  }
}

export interface ResolvePlanRefOptions {
  /** The repository whose `awsf.project.yaml` registers the plans. */
  readonly repository: string;
  /** Needed only for a foreign placement, exactly as the planning join needs it. */
  readonly stateRoot: string;
  readonly project: string;
  readonly stem: string;
}

/**
 * Returns the stem when it names a registered plan, and throws naming the
 * candidates when it does not. The stem is the plan's HTML basename and its
 * ticket-directory name, which is the identity the backlog already groups by —
 * so a plan card on the sessions view and a plan group on the backlog are the
 * same plan without a second identifier to keep in step.
 */
export async function resolvePlanRef(options: ResolvePlanRefOptions): Promise<string> {
  const catalogPath = resolve(options.repository, "awsf.project.yaml");
  let source: string;
  try {
    source = await readFile(catalogPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PlanRefNoCatalog(catalogPath);
    throw error;
  }
  const catalog = loadCatalog(source);
  // Self-placement first, then the recorded placement — the same order the
  // planning join uses, so a foreign checkout resolves the same way here.
  let sources = resolvePlanSources(catalogPath, catalog);
  if (sources.length === 0) {
    // No placement recorded is "nothing registered here", not a crash: the
    // refusal below then names an empty candidate list, which is the truth.
    try {
      sources = resolvePlanSources(catalogPath, catalog, await readPlacement(options.stateRoot, options.project));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const candidates = sources.map((plan) => basename(plan.planPath, ".html"));
  if (!candidates.includes(options.stem)) throw new PlanRefUnknown(options.stem, candidates);
  return options.stem;
}

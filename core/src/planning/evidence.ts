// Read-only join. Nothing in an attempt imports planning or consumes this view.
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { scanJournalText } from "../persistence/replay.ts";
import { deriveAttemptStatus, withLegacyDefaults, type AttemptEvent, type AttemptStatus } from "../cli/commands/attempt.ts";
import { loadCatalog } from "../registry/catalog.ts";
import { readPlacement } from "../registry/placement.ts";
import { parseAwsfPlanHtmlV1, resolvePlanSources } from "../registry/plan-source.ts";
import { canonical, hash, safe, verifyReference } from "./store.ts";
import { currentUnit, currentUnits, type Group, type Unit } from "./model.ts";

export type Delivery = "todo" | "wip" | "done" | "unknown" | "stale" | "blocked" | "awaiting-owner";
export interface ObservedAttempt {
  taskId: string;
  attempt: number;
  sessionId: string;
  state: string;
  revision: number;
  candidateSha: string | null;
  journal: string;
  sha256: string;
}
export interface Row {
  id: string;
  revision: number;
  title: string;
  disposition: Unit["disposition"];
  delivery: Delivery;
  conditions: string[];
  observed: ObservedAttempt[];
  evidence: string[];
}
export interface Checklist {
  schema: "awsf/checklist/v1";
  group: string;
  revision: number;
  head: string;
  asOf: string;
  rows: Row[];
}
export async function observedAttempts(stateRoot: string, project: string, task: string): Promise<ObservedAttempt[]> {
  const root = join(stateRoot, "projects", project, "tasks");
  // ENOENT here is unknown inventory, not proof of zero execution.
  const tasks = await readdir(root, { withFileTypes: true });
  if (!tasks.some((entry) => entry.isDirectory() && entry.name === task)) return [];
  const taskDir = join(root, task);
  const readNames = async () => (await readdir(taskDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[1-9][0-9]*$/u.test(entry.name)).map((entry) => entry.name).sort((a, b) => Number(a) - Number(b));
  const names = await readNames();
  if (names.length === 0) throw new Error("task exists without a complete attempt inventory");
  const found: ObservedAttempt[] = [];
  for (const name of names) {
    const journal = join(taskDir, name, "journal.jsonl");
    const text = await readFile(journal, "utf8");
    const scan = scanJournalText<AttemptEvent>(text, journal);
    if (!scan.ok || scan.tornTail !== null) throw new Error("execution journal unavailable or incomplete");
    const status = deriveAttemptStatus(scan.records);
    if (!status || status.project !== project || status.taskId !== task || status.attempt !== Number(name)) throw new Error("execution identity mismatch");
    const projection = withLegacyDefaults(JSON.parse(await readFile(join(taskDir, name, "status.json"), "utf8")) as AttemptStatus);
    if (canonical(status) !== canonical(projection) || text !== await readFile(journal, "utf8")) throw new Error("stale execution projection or concurrent write");
    safe(status);
    found.push({ taskId: task, attempt: status.attempt, sessionId: status.sessionId, state: status.lifecycleState,
      revision: status.revision, candidateSha: status.candidateSha, journal, sha256: hash(text) });
  }
  if (canonical(names) !== canonical(await readNames())) throw new Error("concurrent attempt creation");
  return found;
}
async function registeredPlan(unit: Unit, stateRoot: string, project: string): Promise<{ done: boolean; reference: string } | null> {
  if (!unit.plan) return null;
  const { catalog: path, stem, task, sourceSha256 } = unit.plan;
  const catalog = loadCatalog(await readFile(path, "utf8"));
  if (catalog.project.slug !== project) throw new Error("registered plan project mismatch");
  // Resolve through the registry, including foreign placements. Never guess adjacency.
  let sources = resolvePlanSources(path, catalog);
  if (sources.length === 0) sources = resolvePlanSources(path, catalog, await readPlacement(stateRoot, project));
  const source = sources.find((value) => basename(value.planPath, ".html") === stem);
  if (!source) throw new Error("registered plan source unresolved");
  const html = await readFile(source.planPath, "utf8");
  if (hash(html) !== sourceSha256) throw new Error("registered plan source revision changed");
  const planTask = parseAwsfPlanHtmlV1(html, stem).find((value) => value.number === Number(task.slice(1)));
  const ticketText = await readFile(join(source.ticketsPath, `${task}.md`), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(ticketText);
  if (!planTask || !match) throw new Error("registered ticket or task missing");
  const ticket = parse(match[1]!) as Record<string, unknown>;
  const prompt = (match[2]!.split("## Build prompt\n\n")[1] ?? "").replace(/\n+$/u, "");
  const section = (await readFile(source.promptsPath, "utf8")).split("# Section B — Task prompts (recommended)")[1] ?? "";
  const blocks = [...section.matchAll(/^### ([TW]\d+) — (.+)$/gm)];
  const index = blocks.findIndex((block) => block[1]?.[0] === task[0] && Number(block[1]?.slice(1)) === Number(task.slice(1)));
  const block = blocks[index];
  if (!block || prompt !== section.slice(block.index! + block[0].length, blocks[index + 1]?.index ?? section.length).trim()
    || ticket.id !== task || ticket.title !== block[2] || ticket.milestone !== planTask.milestone) throw new Error("registered plan/ticket compatibility mismatch");
  if (!["todo", "wip", "done", "failed"].includes(String(ticket.state)) || planTask.checklist.length === 0
    || !Array.isArray(ticket.depends_on) || ticket.depends_on.some((id) => typeof id !== "string" || id >= task)
    || canonical(ticket.serves ?? []) !== canonical(planTask.serves)) throw new Error("registered plan/ticket vocabulary or coverage mismatch");
  const done = planTask.checklist.every((marker) => marker === "x");
  if ((ticket.state === "done") !== done || (planTask.milestoneMarker === "x" && !done)
    || (planTask.milestoneMarker === "" && done)) throw new Error("registered plan/ticket status mismatch");
  return { done, reference: `${source.planPath}#${task}@${sourceSha256}` };
}
function delivery(state: string): Delivery {
  if (state === "AWAITING_OWNER") return "awaiting-owner";
  if (state === "BLOCKED" || state === "CANCELLED") return "blocked";
  if (state === "DRAFT" || state === "PREPARED") return "todo";
  if (["RUNNING", "GATING", "REVIEWING", "LANDING"].includes(state)) return "wip";
  return "unknown";
}
export async function checklist(group: Group, stateRoot: string, asOf: string): Promise<Checklist> {
  const rows: Row[] = [];
  for (const unit of currentUnits(group)) {
    const row: Row = { id: unit.id, revision: unit.revision, title: unit.title, disposition: unit.disposition,
      delivery: "unknown", conditions: [], observed: [], evidence: [] };
    try {
      row.observed = await observedAttempts(stateRoot, group.project, unit.taskId);
      row.evidence = row.observed.map((attempt) => `${attempt.journal}@${attempt.sha256}`);
      const plan = await registeredPlan(unit, stateRoot, group.project);
      if (plan) row.evidence.push(plan.reference);
      const binding = group.bindings.filter((value) => value.unit === unit.id && value.revision === unit.revision).at(-1);
      const latest = row.observed.at(-1);
      if (!latest) row.delivery = binding ? "stale" : "todo";
      else if (!binding || binding.sessionId !== latest.sessionId || binding.attempt !== latest.attempt) {
        row.delivery = "stale";
        row.conditions.push("execution is not bound to this unit revision");
      } else {
        row.delivery = delivery(latest.state);
        if (unit.completion === "landed" && ["LANDED", "PUBLISHED"].includes(latest.state) && latest.candidateSha) row.delivery = "done";
      }
      if (unit.completion === "owner-accepted") {
        const acceptance = group.acceptances.filter((value) => value.unit === unit.id && value.revision === unit.revision && value.contract === null).at(-1);
        if (acceptance) {
          for (const ref of acceptance.evidence) await verifyReference(ref);
          row.evidence.push(`owner-decision:${acceptance.decision}`, ...acceptance.evidence.map((ref) => `${ref.path}@${ref.sha256}`));
          row.delivery = "done";
        }
      }
      if (row.delivery === "done" && plan && !plan.done) {
        row.delivery = "awaiting-owner";
        row.conditions.push("registered plan/ticket authority does not declare completion");
      }
      for (const ref of unit.references) {
        await verifyReference(ref);
        row.evidence.push(`${ref.path}@${ref.sha256}`);
      }
    } catch (error) {
      row.delivery = /stale|changed|concurrent|mismatch/u.test((error as Error).message) ? "stale" : "unknown";
      row.conditions.push("evidence lookup incomplete: refresh execution and source references");
    }
    if (unit.decisions.length > 0) row.conditions.push(...unit.decisions.map((decision) => `unresolved: ${decision}`));
    if (unit.disposition === "deferred") row.conditions.push(`deferred: ${unit.reason}. Revisit: ${unit.revisit}. Active attempts are unchanged.`);
    if (unit.disposition === "split") row.conditions.push(`split: ${unit.reason}. This identity is retained for history.`);
    rows.push(row);
  }
  // Dependencies are an advisory condition only, never an execution authorization.
  for (const unit of currentUnits(group)) {
    const row = rows.find((value) => value.id === unit.id)!;
    for (const prerequisite of unit.prerequisites) {
      const target = currentUnit(group, prerequisite.unit);
      let satisfied = target.revision === prerequisite.revision && target.disposition === "active";
      if (prerequisite.kind === "implementation") satisfied &&= rows.find((value) => value.id === target.id)?.delivery === "done";
      else {
        const accepted = group.acceptances.find((value) => value.unit === target.id && value.revision === prerequisite.revision && value.contract === prerequisite.contract);
        satisfied &&= accepted !== undefined;
        if (accepted) {
          try { for (const ref of accepted.evidence) await verifyReference(ref); } catch { satisfied = false; }
        }
      }
      if (!satisfied) row.conditions.push(`blocked prerequisite: ${prerequisite.kind} ${target.id}@${prerequisite.revision}: ${prerequisite.contract}`);
    }
    if (row.delivery === "todo" && row.conditions.some((condition) => /^(blocked prerequisite|unresolved):/u.test(condition))) row.delivery = "blocked";
    if (row.delivery === "done" && row.conditions.some((condition) => condition.startsWith("unresolved:"))) row.delivery = "awaiting-owner";
  }
  return { schema: "awsf/checklist/v1", group: group.id, revision: group.revision, head: group.head, asOf, rows };
}

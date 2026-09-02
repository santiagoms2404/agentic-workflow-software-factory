import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { TICKET_WORKFLOWS, type TicketState, type TicketWorkflow } from "../contracts/ticket.ts";
import { classifyPlans, type PlanIdentity } from "../registry/plan-kind.ts";
import type { ResolvedPlanSource } from "../registry/plan-source.ts";

export interface PlanTicketData {
  readonly id: string;
  readonly title: string;
  readonly milestone: string;
  readonly state: TicketState;
  readonly depends_on: readonly string[];
  readonly tier?: 0 | 1 | 2;
  readonly workflow?: TicketWorkflow;
}

export interface PlanTicketRecord {
  readonly uid: string;
  readonly plan: string;
  readonly path: string;
  readonly ticket: PlanTicketData;
}

export interface PlanTicketGroup {
  readonly plan: PlanIdentity;
  readonly records: readonly PlanTicketRecord[];
}

interface OpenPlan {
  readonly source: ResolvedPlanSource;
  readonly identity: PlanIdentity;
}

interface CacheEntry {
  readonly fingerprint: string;
  readonly record: PlanTicketRecord | null;
}

const STATES = new Set<TicketState>(["todo", "wip", "done", "failed"]);
const WORKFLOWS = new Set<TicketWorkflow>(TICKET_WORKFLOWS);

function ticketData(source: string): PlanTicketData | null {
  const split = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(source);
  if (split === null) return null;
  const document = parseDocument(split[1] ?? "");
  if (document.errors.length > 0) return null;
  const value = document.toJSON() as Record<string, unknown> | null;
  if (value === null
    || typeof value !== "object"
    || typeof value.id !== "string"
    || !/^[TW]\d\d$/u.test(value.id)
    || typeof value.title !== "string"
    || value.title.length === 0
    || typeof value.milestone !== "string"
    || !/^M\d+$/u.test(value.milestone)
    || typeof value.state !== "string"
    || !STATES.has(value.state as TicketState)
    || !Array.isArray(value.depends_on)
    || !value.depends_on.every((dependency) => typeof dependency === "string" && /^[TW]\d\d$/u.test(dependency))) {
    return null;
  }
  if (value.tier !== undefined && value.tier !== 0 && value.tier !== 1 && value.tier !== 2) return null;
  if (value.workflow !== undefined && (typeof value.workflow !== "string" || !WORKFLOWS.has(value.workflow as TicketWorkflow))) return null;
  return Object.freeze({
    id: value.id,
    title: value.title,
    milestone: value.milestone,
    state: value.state as TicketState,
    depends_on: Object.freeze([...value.depends_on] as string[]),
    ...(value.tier === undefined ? {} : { tier: value.tier }),
    ...(value.workflow === undefined ? {} : { workflow: value.workflow as TicketWorkflow }),
  });
}

/**
 * A router-scoped, stat-keyed reader for all catalog-resolved plan stores.
 * Parsed frontmatter is retained only until size or mtime changes; markdown
 * source is read separately on expansion and never enters the list cache.
 */
export class PlanTicketReader {
  readonly sources: readonly ResolvedPlanSource[];
  private readonly plans: readonly OpenPlan[];
  private readonly cache = new Map<string, CacheEntry>();

  constructor(sources: readonly ResolvedPlanSource[]) {
    this.sources = Object.freeze([...sources]);
    const identities = classifyPlans(this.sources);
    this.plans = Object.freeze(identities.map((identity, index) => Object.freeze({
      source: this.sources[index]!,
      identity,
    })));
  }

  async load(): Promise<readonly PlanTicketGroup[]> {
    return Object.freeze(await Promise.all(this.plans.map(async (plan): Promise<PlanTicketGroup> => {
      let names: string[];
      try {
        names = (await readdir(plan.source.ticketsPath))
          .filter((name) => /^[TW]\d\d\.md$/u.test(name))
          .sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return Object.freeze({ plan: plan.identity, records: Object.freeze([]) });
        }
        throw error;
      }

      const records = await Promise.all(names.map(async (name): Promise<PlanTicketRecord | null> => {
        const path = join(plan.source.ticketsPath, name);
        let metadata;
        try {
          metadata = await stat(path, { bigint: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
        const fingerprint = `${metadata.size}:${metadata.mtimeNs}`;
        const cached = this.cache.get(path);
        if (cached?.fingerprint === fingerprint) return cached.record;

        const parsed = ticketData(await readFile(path, "utf8"));
        const record = parsed === null ? null : Object.freeze({
          uid: `${plan.identity.id}/${parsed.id}`,
          plan: plan.identity.id,
          path,
          ticket: parsed,
        });
        this.cache.set(path, Object.freeze({ fingerprint, record }));
        return record;
      }));

      return Object.freeze({
        plan: plan.identity,
        records: Object.freeze(records.filter((record): record is PlanTicketRecord => record !== null)),
      });
    })));
  }

  /** Reads complete repository ticket text only for an explicit expansion. */
  async source(planId: string, ticketId: string): Promise<string | null> {
    if (!/^[TW]\d\d$/u.test(ticketId)) return null;
    const plan = this.plans.find((candidate) => candidate.identity.id === planId);
    if (plan === undefined) return null;
    try {
      return await readFile(join(plan.source.ticketsPath, `${ticketId}.md`), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

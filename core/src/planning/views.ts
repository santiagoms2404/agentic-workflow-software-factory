import { affectedSuccessors, applyChanges, currentUnit, currentUnits, type Group, type Proposal, type Reference } from "./model.ts";
import { canonical, hash, proposalHash, verifyReference } from "./store.ts";
import type { Checklist } from "./evidence.ts";

export function changedUnits(proposal: Proposal): string[] {
  return [...new Set(proposal.changes.flatMap((change) => {
    if (change.kind === "define") return [change.unit.id];
    if (change.kind === "split") return [change.unit, ...change.children.map((unit) => unit.id)];
    if (change.kind === "defer" || change.kind === "accept-interface" || change.kind === "accept-delivery") return [change.unit];
    if (change.kind === "bind") return [change.binding.unit];
    return [];
  }))];
}
export function bounded(value: unknown, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("budget must be a positive byte count");
  const text = JSON.stringify(JSON.parse(canonical(value)) as unknown, null, 2) + "\n";
  const needed = Buffer.byteLength(text);
  if (needed > maxBytes) throw new Error(`packet overflow: requires ${needed} bytes, budget ${maxBytes}. No partial output. Narrow the scope or increase --max-bytes.`);
  return text;
}
export function previewGroup(group: Group, id: string): Group {
  const proposal = group.proposals.find((value) => value.id === id);
  if (!proposal || group.decisions.includes(id)) throw new Error("preview requires an unapplied proposal");
  if (proposal.base + 1 !== group.revision) throw new Error("proposal is stale: re-propose before preview");
  const preview = applyChanges(group, proposal);
  // Previewing approval operations must not manufacture accepted evidence.
  preview.acceptances = group.acceptances;
  preview.bindings = group.bindings;
  preview.closed = group.closed;
  return preview;
}
export async function packet(group: Group, observation: Checklist, selection: string | null, maxBytes: number, preview: string | null = null): Promise<string> {
  if (observation.head !== group.head || observation.revision !== group.revision) throw new Error("stale checklist snapshot");
  const units = selection === null ? currentUnits(group) : [currentUnit(group, selection)];
  const selected = new Set(units.map((unit) => unit.id));
  const dependencyIds = new Set(units.flatMap((unit) => unit.prerequisites.map((dep) => dep.unit)));
  const amendments = group.proposals.filter((proposal) => {
    const changed = changedUnits(proposal);
    const global = proposal.changes.some((change) => ["constraints", "requirements", "order", "close"].includes(change.kind));
    return selection === null || global || changed.some((id) => selected.has(id) || dependencyIds.has(id))
      || affectedSuccessors(group, changed).some((id) => selected.has(id));
  }).map((proposal) => ({ id: proposal.id, base: proposal.base, narrative: proposal.narrative,
    alternatives: proposal.alternatives, hash: proposalHash(proposal),
    authority: group.decisions.includes(proposal.id) ? "owner-decision" : "assistant-proposal",
    applicability: group.decisions.includes(proposal.id) ? "accepted history" : proposal.base + 1 === group.revision ? "current proposal" : "stale proposal",
    changes: proposal.changes.map((change) => {
      if (change.kind === "define") return { kind: change.kind, unit: change.unit.id, revision: change.unit.revision };
      if (change.kind === "split") return { kind: change.kind, unit: change.unit, children: change.children.map((unit) => ({ id: unit.id, revision: unit.revision })), reason: change.reason };
      if (change.kind === "constraints" || change.kind === "requirements") return { kind: change.kind, count: change.values.length, sha256: hash(canonical(change.values)) };
      return change;
    }),
    affectedSuccessors: affectedSuccessors(group, changedUnits(proposal)) }));
  const stages = group.stages.filter((stage) => stage.input !== null);
  const prerequisites = units.flatMap((unit) => unit.prerequisites.map((dep) => ({ ...dep,
    currentRevision: currentUnit(group, dep.unit).revision,
    acceptance: currentUnit(group, dep.unit).acceptance,
    decisions: currentUnit(group, dep.unit).decisions,
    references: currentUnit(group, dep.unit).references,
    observation: observation.rows.find((row) => row.id === dep.unit),
  })));
  const refs: Reference[] = [...units.flatMap((unit) => unit.references), ...prerequisites.flatMap((dep) => dep.references),
    ...amendments.filter((amendment) => amendment.applicability === "current proposal").flatMap((amendment) => amendment.narrative.references)];
  // Superseded narratives remain readable history. Requiring their old file hashes
  // to match today's checkout would make every later refinement permanently fail.
  const historicalReferences = [...stages.flatMap((stage) => stage.narrative.references),
    ...amendments.flatMap((amendment) => amendment.narrative.references),
    ...amendments.flatMap((amendment) => amendment.changes.flatMap((change) => "evidence" in change ? change.evidence : []))];
  const refId = (ref: Reference): string => `source-${hash(canonical(ref))}`;
  const distinct = [...new Map(refs.map((ref) => [refId(ref), ref])).values()];
  for (const ref of distinct) await verifyReference(ref);
  const current = new Set(distinct.map(refId));
  const sources = [...new Map([...historicalReferences, ...distinct].map((ref) => [refId(ref), {
    ...ref, id: refId(ref), freshness: current.has(refId(ref)) ? "hash-verified" : "historical provenance; load and verify if needed for this scope",
  }])).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Reference records occur exactly once. Stable content identities replace every
  // repeated copy without dropping the locator, provenance or freshness fields.
  const sourcePointers = new Map(sources.map((ref) => [`${ref.path}@${ref.sha256}`, ref.id]));
  const intern = (value: unknown): unknown => {
    if (typeof value === "string" && sourcePointers.has(value)) return { reference: sourcePointers.get(value) };
    if (Array.isArray(value)) return value.map(intern);
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.path === "string" && typeof record.sha256 === "string" && typeof record.locator === "string" && typeof record.kind === "string") return { reference: refId(value as Reference) };
      return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, intern(child)]));
    }
    return value;
  };
  const content = { schema: "awsf/planning-packet/v1", kind: selection === null ? "orientation" : "focus",
    authority: preview === null ? "derived planning view only; no execution authorization or accounting authority" : "assistant-proposal preview; scope is not owner-approved",
    preview,
    group: group.id, project: group.project, revision: group.revision, head: group.head, asOf: observation.asOf,
    closed: group.closed, constraints: group.constraints, requirements: group.requirements,
    // Exact originals are retained once. The skill requires reading each complete input once.
    inputs: group.inputs.map((input) => ({ id: input.id, sha256: input.sha256, bytes: Buffer.byteLength(input.text), provenance: input.provenance, attachmentDigests: input.attachments.map((ref) => ref.sha256) })),
    scope: selection === null ? units.map((unit) => ({ id: unit.id, revision: unit.revision, title: unit.title, disposition: unit.disposition, decisions: unit.decisions })) : units,
    schedulingPreference: group.order, prerequisites, amendments,
    inputStages: stages.map((stage) => ({ id: stage.id, at: stage.at, authority: stage.authority, narrativeAuthority: stage.narrativeAuthority, title: stage.narrative.title, input: stage.input })),
    historicalReferences,
    observations: observation.rows.filter((row) => selected.has(row.id)).map((row) => preview === null ? row : { ...row, delivery: "unknown", conditions: ["proposal scope is not owner-approved", ...row.conditions] }),
  };
  return bounded({ ...intern(content) as Record<string, unknown>, references: sources }, maxBytes);
}

// ---------------------------------------------------------------------------
// The decision tree — a read-only projection of one group's journal.
//
// Everything above this line serves the CLI packet, which verifies every
// reference against the checkout before it will render. That is right for a
// planning packet a session is about to act on and wrong for a screen: one
// moved file would make the whole history unreadable. So the tree reads the
// journal and nothing else, and a reference is reported as a path and a digest
// rather than loaded.
//
// It is a tree of DECISIONS, not of messages. The stages of one group are a
// journal and do not branch on their own; the branching lives in proposals that
// were never applied, in alternatives that were written down and not taken, and
// in unit revisions that were superseded. Measured on `marimba-task-3-5` when
// this was written: 71 stages, 31 inputs, 21 proposals of which 19 were applied
// and 2 never were, 46 recorded alternatives and 24 unit records across 9
// units. A flat timeline shows the 71 and hides the other 70.
// ---------------------------------------------------------------------------

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { identifier, type Change, type Narrative, type Stage, type Unit } from "./model.ts";
import { replay, type Location } from "./store.ts";

/** The first line of the owner's own words, bounded. Never generated. */
const TITLE_BUDGET = 180;

export interface TreeReference {
  readonly path: string;
  readonly sha256: string;
  readonly locator: string;
  readonly kind: "text" | "attachment";
}

/**
 * A narrative exactly as recorded, empty strings included. A missing field is
 * displayed as missing; nothing here fills one in.
 */
export interface TreeNarrative {
  readonly title: string;
  readonly explanation: string;
  readonly changes: string;
  readonly reason: string;
  readonly friction: string;
  readonly tasks: readonly string[];
  readonly references: readonly TreeReference[];
}

export interface TreeAsk {
  readonly stageId: string;
  readonly at: string;
  readonly inputId: string;
  readonly text: string;
  readonly provenance: string;
  readonly sha256: string;
  /** The assistant's explanation of the ask, which is NOT the ask itself. */
  readonly narrative: TreeNarrative;
}

export interface TreeChange {
  readonly kind: Change["kind"];
  /** The unit an operation names, when it names one. */
  readonly unit: string | null;
  readonly detail: string;
}

export interface TreeProposal {
  readonly id: string;
  readonly base: number;
  readonly proposedStageId: string;
  readonly proposedAt: string;
  readonly narrative: TreeNarrative;
  /** Options written down and deliberately not taken. */
  readonly alternatives: readonly string[];
  readonly changes: readonly TreeChange[];
  readonly status: "applied" | "not-taken";
  /** A not-taken proposal that a later stage has already made unappliable. */
  readonly appliable: boolean;
  readonly decisionStageId: string | null;
  readonly decidedAt: string | null;
  /** The owner's written reason on the decision stage, when it was applied. */
  readonly ownerReason: string | null;
  /** The most recent owner input at or before this proposal, or null. */
  readonly ask: string | null;
  readonly tasks: readonly string[];
}

export interface TreeUnitRevision {
  readonly revision: number;
  readonly title: string;
  readonly disposition: Unit["disposition"];
  readonly reason: string;
  readonly revisit: string;
}

export interface TreeUnit {
  readonly id: string;
  readonly taskId: string;
  readonly current: TreeUnitRevision;
  /** Older revisions, oldest first. Superseded, never erased. */
  readonly superseded: readonly TreeUnitRevision[];
}

export interface TreeCounts {
  readonly stages: number;
  readonly inputs: number;
  readonly proposals: number;
  readonly applied: number;
  readonly notTaken: number;
  readonly alternatives: number;
  readonly unitRecords: number;
  readonly units: number;
}

export interface GroupTree {
  readonly schema: "awsf/decision-tree/v1";
  readonly group: string;
  readonly project: string;
  readonly revision: number;
  readonly head: string;
  readonly closed: boolean;
  /**
   * The title above a group of related runs: the owner's own first words,
   * bounded to one line. `full` is the complete input so a reader can open it.
   * Null when the group holds no input, which no valid group does.
   */
  readonly title: { readonly text: string; readonly full: string; readonly inputId: string; readonly stageId: string; readonly at: string } | null;
  readonly asks: readonly TreeAsk[];
  /** Applied decisions, in the order the owner took them. */
  readonly spine: readonly TreeProposal[];
  /** Proposed and never applied. Visible as not taken, never omitted. */
  readonly notTaken: readonly TreeProposal[];
  readonly units: readonly TreeUnit[];
  /** taskId -> the proposals and asks that name it, for tracing a run back. */
  readonly byTask: Readonly<Record<string, { readonly proposals: readonly string[]; readonly asks: readonly string[] }>>;
  readonly counts: TreeCounts;
}

export interface GroupSummary {
  readonly group: string;
  readonly project: string;
  readonly revision: number;
  readonly closed: boolean;
  readonly title: string | null;
  readonly at: string | null;
  readonly counts: TreeCounts;
}

function treeNarrative(narrative: Narrative): TreeNarrative {
  return {
    title: narrative.title, explanation: narrative.explanation, changes: narrative.changes,
    reason: narrative.reason, friction: narrative.friction, tasks: [...narrative.tasks],
    references: narrative.references.map((reference) => ({
      path: reference.path, sha256: reference.sha256, locator: reference.locator, kind: reference.kind,
    })),
  };
}

/** One line naming what a change does, without restating the whole unit. */
function treeChange(change: Change): TreeChange {
  switch (change.kind) {
    case "define": return { kind: change.kind, unit: change.unit.id, detail: `revision ${change.unit.revision}: ${change.unit.title}` };
    case "split": return { kind: change.kind, unit: change.unit, detail: `into ${change.children.map((child) => child.id).join(", ")}: ${change.reason}` };
    case "defer": return { kind: change.kind, unit: change.unit, detail: `${change.reason} Revisit: ${change.revisit}` };
    case "order": return { kind: change.kind, unit: null, detail: change.units.join(" -> ") };
    case "constraints": return { kind: change.kind, unit: null, detail: `${change.values.length} constraint(s)` };
    case "requirements": return { kind: change.kind, unit: null, detail: `${change.values.length} requirement(s)` };
    case "bind": return { kind: change.kind, unit: change.binding.unit, detail: `${change.binding.taskId} attempt ${change.binding.attempt}` };
    case "accept-delivery": return { kind: change.kind, unit: change.unit, detail: `revision ${change.revision}` };
    case "accept-interface": return { kind: change.kind, unit: change.unit, detail: `revision ${change.revision}: ${change.contract}` };
    case "close": return { kind: change.kind, unit: null, detail: change.reason };
  }
}

function firstLine(text: string): string {
  const line = text.split("\n").map((value) => value.trim()).find((value) => value.length > 0) ?? "";
  return line.length <= TITLE_BUDGET ? line : `${line.slice(0, TITLE_BUDGET - 1)}…`;
}

/** The owner input in force at a stage: the most recent one at or before it. */
function askAt(stages: readonly Stage[], index: number): string | null {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const input = stages[cursor]?.input;
    if (input !== null && input !== undefined) return input;
  }
  return null;
}

export function decisionTree(group: import("./model.ts").Group): GroupTree {
  const stages = group.stages;
  const proposalStage = new Map<string, { stage: Stage; index: number }>();
  const decisionStage = new Map<string, Stage>();
  for (const [index, stage] of stages.entries()) {
    if (stage.proposal === null) continue;
    if (stage.authority === "assistant-proposal") proposalStage.set(stage.proposal, { stage, index });
    if (stage.authority === "owner-decision") decisionStage.set(stage.proposal, stage);
  }

  const proposals: TreeProposal[] = group.proposals.map((proposal) => {
    const proposed = proposalStage.get(proposal.id);
    const decided = decisionStage.get(proposal.id) ?? null;
    const applied = group.decisions.includes(proposal.id);
    return {
      id: proposal.id,
      base: proposal.base,
      proposedStageId: proposed?.stage.id ?? "",
      proposedAt: proposed?.stage.at ?? "",
      // An accepted proposal's stage carries the OWNER's reason in place of the
      // assistant's; the proposal itself keeps what was written when it was
      // made. Both are reported rather than one overwriting the other.
      narrative: treeNarrative(proposal.narrative),
      alternatives: [...proposal.alternatives],
      changes: proposal.changes.map(treeChange),
      status: applied ? "applied" : "not-taken",
      // Every intervening stage invalidates approval, so a not-taken proposal
      // is either still appliable or was overtaken. Saying which is the
      // difference between "nobody has decided yet" and "this can no longer be
      // taken without being re-proposed".
      appliable: !applied && proposal.base + 1 === group.revision,
      decisionStageId: decided?.id ?? null,
      decidedAt: decided?.at ?? null,
      ownerReason: decided?.narrative.reason ?? null,
      ask: proposed === undefined ? null : askAt(stages, proposed.index),
      tasks: [...proposal.narrative.tasks],
    };
  });

  const asks: TreeAsk[] = stages.flatMap((stage) => {
    if (stage.input === null) return [];
    const input = group.inputs.find((value) => value.id === stage.input);
    if (input === undefined) return [];
    return [{
      stageId: stage.id, at: stage.at, inputId: input.id, text: input.text,
      provenance: input.provenance, sha256: input.sha256, narrative: treeNarrative(stage.narrative),
    }];
  });

  const units: TreeUnit[] = group.order.map((id) => {
    const records = group.units.filter((unit) => unit.id === id);
    const current = records[records.length - 1]!;
    const revision = (unit: Unit): TreeUnitRevision => ({
      revision: unit.revision, title: unit.title, disposition: unit.disposition,
      reason: unit.reason, revisit: unit.revisit,
    });
    return { id, taskId: current.taskId, current: revision(current), superseded: records.slice(0, -1).map(revision) };
  });

  const byTask: Record<string, { proposals: string[]; asks: string[] }> = {};
  const entry = (task: string): { proposals: string[]; asks: string[] } => (byTask[task] ??= { proposals: [], asks: [] });
  for (const proposal of proposals) for (const task of proposal.tasks) entry(task).proposals.push(proposal.id);
  for (const ask of asks) for (const task of ask.narrative.tasks) entry(task).asks.push(ask.inputId);
  for (const unit of units) entry(unit.taskId);

  const first = asks[0] ?? null;
  return {
    schema: "awsf/decision-tree/v1",
    group: group.id, project: group.project, revision: group.revision, head: group.head, closed: group.closed,
    title: first === null ? null : {
      text: firstLine(first.text), full: first.text, inputId: first.inputId, stageId: first.stageId, at: first.at,
    },
    asks,
    spine: group.decisions.flatMap((id) => proposals.filter((proposal) => proposal.id === id)),
    notTaken: proposals.filter((proposal) => proposal.status === "not-taken"),
    units,
    byTask,
    counts: {
      stages: stages.length,
      inputs: group.inputs.length,
      proposals: proposals.length,
      applied: proposals.filter((proposal) => proposal.status === "applied").length,
      notTaken: proposals.filter((proposal) => proposal.status === "not-taken").length,
      alternatives: proposals.reduce((total, proposal) => total + proposal.alternatives.length, 0),
      unitRecords: group.units.length,
      units: group.order.length,
    },
  };
}

/** Group ids present for a project. An absent directory is zero groups, not an error. */
export async function listGroupIds(stateRoot: string, project: string): Promise<readonly string[]> {
  identifier(project);
  try {
    const entries = await readdir(join(stateRoot, "projects", project, "groups"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Replays one group's journal and projects its decision tree. Read-only. */
export async function readGroupTree(location: Location): Promise<GroupTree> {
  const { group } = await replay(location);
  return decisionTree(group);
}

export function groupSummary(tree: GroupTree): GroupSummary {
  return {
    group: tree.group, project: tree.project, revision: tree.revision, closed: tree.closed,
    title: tree.title?.text ?? null, at: tree.title?.at ?? null, counts: tree.counts,
  };
}

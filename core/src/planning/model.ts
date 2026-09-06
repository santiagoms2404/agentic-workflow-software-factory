// Planning intent is separate from execution state. This module performs no I/O.
export interface Reference {
  path: string;
  sha256: string;
  repository: string;
  revision: string;
  locator: string;
  kind: "text" | "attachment";
}
export interface Input {
  id: string;
  text: string;
  sha256: string;
  provenance: string;
  attachments: Reference[];
}
export interface Narrative {
  title: string;
  explanation: string;
  changes: string;
  reason: string;
  friction: string;
  tasks: string[];
  references: Reference[];
}
export interface Prerequisite {
  unit: string;
  revision: number;
  kind: "interface" | "implementation";
  contract: string;
}
export interface Unit {
  id: string;
  revision: number;
  title: string;
  purpose: string;
  taskId: string;
  scope: string[];
  nonGoals: string[];
  serves: string[];
  acceptance: string[];
  prerequisites: Prerequisite[];
  decisions: string[];
  references: Reference[];
  completion: "landed" | "owner-accepted";
  plan?: { catalog: string; stem: string; task: string; sourceSha256: string };
  disposition: "active" | "deferred" | "split";
  reason: string;
  revisit: string;
  parents: string[];
}
export interface Requirement { id: string; text: string }
export interface Binding { unit: string; revision: number; taskId: string; attempt: number; sessionId: string }
export type Change =
  | { kind: "define"; unit: Unit }
  | { kind: "split"; unit: string; children: Unit[]; reason: string }
  | { kind: "defer"; unit: string; reason: string; revisit: string }
  | { kind: "order"; units: string[] }
  | { kind: "constraints"; values: string[] }
  | { kind: "requirements"; values: Requirement[] }
  | { kind: "bind"; binding: Binding }
  | { kind: "accept-delivery"; unit: string; revision: number; evidence: Reference[] }
  | { kind: "accept-interface"; unit: string; revision: number; contract: string; evidence: Reference[] }
  | { kind: "close"; reason: string };
export interface Proposal {
  id: string;
  base: number;
  narrative: Narrative;
  changes: Change[];
  alternatives: string[];
}
export interface Acceptance {
  unit: string;
  revision: number;
  decision: string;
  evidence: Reference[];
  contract: string | null;
}
export interface Stage {
  id: string;
  at: string;
  authority: "owner-input" | "assistant-proposal" | "owner-decision";
  narrativeAuthority: "assistant-explanation" | "accepted-proposal";
  narrative: Narrative;
  input: string | null;
  proposal: string | null;
}
export interface Group {
  schema: "awsf/group/v1";
  id: string;
  project: string;
  revision: number;
  head: string;
  closed: boolean;
  inputs: Input[];
  stages: Stage[];
  units: Unit[];
  order: string[];
  constraints: string[];
  requirements: Requirement[];
  proposals: Proposal[];
  decisions: string[];
  bindings: Binding[];
  acceptances: Acceptance[];
}
export type Operation =
  | { kind: "capture"; input: Input; narrative: Narrative }
  | { kind: "propose"; proposal: Proposal }
  | { kind: "apply"; proposal: string; proposalHash: string; ownerReason: string };
export interface Event {
  schema: "awsf/group-event/v1";
  group: string;
  project: string;
  id: string;
  base: number;
  at: string;
  previous: string;
  operation: Operation;
  digest: string;
}
export function identifier(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(value)) throw new Error("expected a path-safe identifier (1–100 characters)");
  return value;
}
export function emptyGroup(project: string, id: string): Group {
  identifier(project);
  identifier(id);
  return { schema: "awsf/group/v1", id, project, revision: 0, head: "", closed: false,
    inputs: [], stages: [], units: [], order: [], constraints: [], requirements: [], proposals: [],
    decisions: [], bindings: [], acceptances: [] };
}
export function currentUnit(group: Group, id: string): Unit {
  const unit = group.units.filter((value) => value.id === id).at(-1);
  if (unit === undefined) throw new Error(`missing unit ${id}`);
  return unit;
}
export function currentUnits(group: Group): Unit[] {
  return group.order.map((id) => currentUnit(group, id));
}
function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}
function unitRevision(group: Group, id: string, revision: number): Unit {
  const unit = currentUnit(group, id);
  if (unit.revision !== revision) throw new Error(`stale unit revision: ${id}`);
  return unit;
}
export function affectedSuccessors(group: Group, selected: string[]): string[] {
  const affected = new Set(selected);
  const units = currentUnits(group);
  let changed = true;
  while (changed) {
    changed = false;
    for (const unit of units) {
      if (!affected.has(unit.id) && unit.prerequisites.some((dep) => affected.has(dep.unit))) {
        affected.add(unit.id);
        changed = true;
      }
    }
  }
  return group.order.filter((id) => affected.has(id) && !selected.includes(id));
}
export function validateGraph(group: Group): void {
  unique(group.order, "order entry");
  unique(group.requirements.map((requirement) => requirement.id), "requirement");
  const units = currentUnits(group);
  if (new Set(group.units.map((unit) => unit.id)).size !== group.order.length) throw new Error("order must contain every stable unit id");
  const requirements = new Set(group.requirements.map((requirement) => requirement.id));
  const covered = new Set<string>();
  for (const unit of units) {
    identifier(unit.id);
    identifier(unit.taskId);
    if (unit.disposition === "deferred" && (!unit.reason.trim() || !unit.revisit.trim())) throw new Error("deferral needs a reason and revisit condition");
    if (unit.disposition === "split" && !unit.reason.trim()) throw new Error("split needs a reason");
    unique(unit.serves, "requirement claim");
    unique(unit.prerequisites.map((dep) => dep.unit), "prerequisite");
    for (const id of unit.serves) {
      if (!requirements.has(id)) throw new Error(`undeclared requirement ${id}`);
      if (unit.disposition !== "split") covered.add(id);
    }
    for (const parent of unit.parents) currentUnit(group, parent);
    for (const dep of unit.prerequisites) {
      const target = currentUnit(group, dep.unit);
      if (!group.units.some((old) => old.id === dep.unit && old.revision === dep.revision)) throw new Error(`missing prerequisite revision ${dep.unit}@${dep.revision}`);
      if (target.disposition === "split") throw new Error(`prerequisite ${dep.unit} was split: retarget its successors explicitly`);
    }
  }
  for (const id of requirements) if (!covered.has(id)) throw new Error(`uncovered requirement ${id}`);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`cyclic prerequisites at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of currentUnit(group, id).prerequisites) visit(dep.unit);
    visiting.delete(id);
    visited.add(id);
  };
  for (const unit of units) visit(unit.id);
}
function define(group: Group, unit: Unit): void {
  const old = group.units.filter((value) => value.id === unit.id).at(-1);
  if (unit.revision !== (old?.revision ?? 0) + 1) throw new Error(`noncontiguous unit revision ${unit.id}`);
  if (old?.disposition === "split") throw new Error(`split identity ${unit.id} cannot be reused`);
  if (old && JSON.stringify(old.parents) !== JSON.stringify(unit.parents)) throw new Error("lineage is immutable");
  group.units.push(unit);
  if (!old) group.order.push(unit.id);
}
export function applyChanges(source: Group, proposal: Proposal): Group {
  const group = structuredClone(source);
  for (const change of proposal.changes) {
    switch (change.kind) {
      case "define": define(group, change.unit); break;
      case "constraints": group.constraints = change.values; break;
      case "requirements": group.requirements = change.values; break;
      case "order": group.order = change.units; break;
      case "defer": {
        const old = currentUnit(group, change.unit);
        if (old.disposition === "split") throw new Error("cannot defer a split parent");
        // Disposition changes do not change acceptance or transfer execution authority.
        group.units.push({ ...old, revision: old.revision + 1, disposition: "deferred", reason: change.reason, revisit: change.revisit });
        break;
      }
      case "split": {
        const old = currentUnit(group, change.unit);
        if (old.disposition === "split") throw new Error("unit already split");
        if (change.children.length < 2) throw new Error("split needs at least two children");
        group.units.push({ ...old, revision: old.revision + 1, disposition: "split", reason: change.reason });
        const served = new Set(change.children.flatMap((child) => child.serves));
        for (const id of old.serves) if (!served.has(id)) throw new Error(`split lost requirement ${id}`);
        for (const child of change.children) {
          if (group.units.some((unit) => unit.id === child.id)) throw new Error("split children must have new identities");
          if (!child.parents.includes(old.id)) throw new Error("split child must retain parent identity");
          define(group, child);
        }
        break;
      }
      case "bind": {
        const unit = unitRevision(group, change.binding.unit, change.binding.revision);
        if (unit.taskId !== change.binding.taskId) throw new Error("binding task differs from unit task");
        group.bindings.push(change.binding);
        break;
      }
      case "accept-delivery":
      case "accept-interface": {
        const unit = unitRevision(group, change.unit, change.revision);
        if (change.kind === "accept-delivery" && unit.completion !== "owner-accepted") throw new Error("owner acceptance cannot substitute for landing");
        group.acceptances.push({ unit: unit.id, revision: unit.revision, decision: proposal.id,
          evidence: change.evidence, contract: change.kind === "accept-interface" ? change.contract : null });
        break;
      }
      case "close": group.closed = true; break;
    }
  }
  const changedConstraints = JSON.stringify(group.constraints) !== JSON.stringify(source.constraints);
  const priorRequirements = new Map(source.requirements.map((value) => [value.id, value.text]));
  const nextRequirements = new Map(group.requirements.map((value) => [value.id, value.text]));
  for (const prior of currentUnits(source)) {
    if (prior.disposition === "split") continue;
    const changedRequirement = prior.serves.some((id) => priorRequirements.get(id) !== nextRequirements.get(id));
    if ((changedConstraints || changedRequirement) && currentUnit(group, prior.id).revision === prior.revision) {
      // Global acceptance context cannot inherit old delivery. The host carries
      // unchanged unit fields forward, avoiding a model rewrite of every unit.
      group.units.push({ ...prior, revision: prior.revision + 1 });
    }
  }
  for (const change of proposal.changes) {
    if (change.kind === "bind") unitRevision(group, change.binding.unit, change.binding.revision);
    if (change.kind === "accept-delivery" || change.kind === "accept-interface") unitRevision(group, change.unit, change.revision);
  }
  validateGraph(group);
  return group;
}
export function reduceEvent(source: Group, event: Event): Group {
  if (event.base !== source.revision || event.previous !== source.head) throw new Error("stale group revision or chain");
  if (source.closed) throw new Error("group is closed: capture the handoff in a new group");
  if (event.group !== source.id || event.project !== source.project) throw new Error("journal identity mismatch");
  const op = event.operation;
  let group = structuredClone(source);
  let stage: Stage;
  if (op.kind === "capture") {
    if (group.inputs.some((input) => input.id === op.input.id)) throw new Error("input identity already exists");
    group.inputs.push(op.input);
    stage = { id: event.id, at: event.at, authority: "owner-input", narrativeAuthority: "assistant-explanation", narrative: op.narrative, input: op.input.id, proposal: null };
  } else if (op.kind === "propose") {
    if (group.inputs.length === 0) throw new Error("capture original input first");
    if (op.proposal.base !== source.revision) throw new Error("proposal targets a stale group revision");
    if (group.proposals.some((proposal) => proposal.id === op.proposal.id)) throw new Error("proposal identity already exists");
    applyChanges(group, op.proposal);
    group.proposals.push(op.proposal);
    stage = { id: event.id, at: event.at, authority: "assistant-proposal", narrativeAuthority: "assistant-explanation", narrative: op.proposal.narrative, input: null, proposal: op.proposal.id };
  } else {
    const proposal = group.proposals.find((value) => value.id === op.proposal);
    if (!proposal || group.decisions.includes(proposal.id)) throw new Error("proposal missing or already applied");
    // Every intervening stage invalidates approval. Re-propose against the latest revision.
    if (proposal.base + 1 !== source.revision) throw new Error("proposal is stale: re-propose, do not rebase approval");
    group = applyChanges(group, proposal);
    group.decisions.push(proposal.id);
    stage = { id: event.id, at: event.at, authority: "owner-decision", narrativeAuthority: "accepted-proposal", narrative: { ...proposal.narrative, reason: op.ownerReason }, input: null, proposal: proposal.id };
  }
  for (const task of stage.narrative.tasks) identifier(task);
  group.stages.push(stage);
  group.revision = source.revision + 1;
  group.head = event.digest;
  return group;
}

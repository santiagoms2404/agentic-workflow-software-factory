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

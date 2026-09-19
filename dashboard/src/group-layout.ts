import type { GroupTree, TreeProposal, TreeUnit } from "../shared/types.ts";

/**
 * Laying the journal out as a real tree.
 *
 * The stages of one group are a journal and do not branch, so a tree drawn from
 * stages is a straight line with nothing to look at. The branching lives in
 * three places, and this turns those into nodes and edges:
 *
 *   the SPINE   one node per applied decision, in the order the owner took them
 *   BRANCHES    hanging off each decision: the alternatives it weighed and
 *               dropped, and the unit revisions it superseded
 *   DETACHED    proposals that were never applied, which belong to no decision
 *               and hang off the ask they came from instead
 *
 * Pure geometry: no DOM, no measurement, no layout engine. The column and row
 * of every node is decided here so the SVG edges and the HTML nodes read from
 * one source and cannot drift apart, and so this is testable without a browser.
 */

export type NodeKind = "ask" | "decision" | "alternative" | "superseded" | "not-taken";

export interface TreeNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** 0 is the ask rail, 1 the decision spine, 2 everything hanging off it. */
  readonly column: number;
  /** Row index in the layout grid, top to bottom. */
  readonly row: number;
  readonly label: string;
  /** The fuller text a reader opens; empty when nothing was recorded. */
  readonly detail: string;
  readonly at: string | null;
  /** The node this one hangs from, or null for a root. */
  readonly parent: string | null;
}

export interface TreeEdge {
  readonly from: string;
  readonly to: string;
  /** A spine edge is the trunk; a branch edge is something hanging off it. */
  readonly kind: "spine" | "branch";
}

export interface TreeLayout {
  readonly nodes: readonly TreeNode[];
  readonly edges: readonly TreeEdge[];
  readonly columns: number;
  readonly rows: number;
}

function line(text: string, budget: number): string {
  const first = text.split("\n").map((value) => value.trim()).find((value) => value.length > 0) ?? "";
  return first.length <= budget ? first : `${first.slice(0, budget - 1)}…`;
}

interface Branch { readonly id: string; readonly kind: NodeKind; readonly label: string; readonly detail: string }

function decisionBranches(decision: TreeProposal, units: readonly TreeUnit[]): readonly Branch[] {
  const branches: Branch[] = decision.alternatives.map((alternative, index) => ({
    id: `${decision.id}:alt:${index}`,
    kind: "alternative",
    label: line(alternative, 72),
    detail: alternative,
  }));
  // A unit revision this decision superseded hangs off it too: the decision is
  // what superseded it, so the edge is the honest one to draw.
  for (const unit of units) {
    if (!decision.tasks.includes(unit.taskId) && !decision.changes.some((change) => change.unit === unit.id)) continue;
    for (const revision of unit.superseded) {
      branches.push({
        id: `${decision.id}:sup:${unit.id}:${revision.revision}`,
        kind: "superseded",
        label: `${unit.id} r${revision.revision} superseded`,
        detail: `${revision.title} — ${revision.disposition}${revision.reason ? `. ${revision.reason}` : ""}`,
      });
    }
  }
  return branches;
}

/**
 * Rows advance monotonically down the page, so a node never sits above its own
 * parent and an edge never points backwards.
 *
 * The order is by ASK, not by node kind. Laying every ask out first and every
 * decision after it put thirty-one asks above the first decision on the real
 * group — a column of messages with edges running off the bottom of the screen,
 * which is the flat timeline this was built to replace. Each ask is now
 * immediately followed by what came out of it, which is what "how that ask
 * became these tasks" actually looks like.
 *
 * The spine edge still chains decisions to one another across asks, so the
 * trunk stays visible through the branching.
 */
export function layoutTree(tree: GroupTree): TreeLayout {
  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  let row = 0;
  let previousDecision: string | null = null;

  const emitProposal = (
    proposal: TreeProposal,
    parent: string | null,
    kind: "decision" | "not-taken",
  ): void => {
    const id = `${kind}:${proposal.id}`;
    nodes.push({
      id, kind, column: 1, row,
      label: proposal.narrative.title,
      detail: kind === "decision" ? proposal.ownerReason ?? "" : proposal.narrative.explanation,
      at: kind === "decision" ? proposal.decidedAt : proposal.proposedAt,
      parent,
    });
    if (parent !== null) edges.push({ from: parent, to: id, kind: "branch" });
    if (kind === "decision") {
      // Two edges, deliberately: the branch back to the ask it came from, above,
      // and the trunk from the decision before it. A decision has both a place
      // in the sequence and an origin; drawing one loses the other.
      if (previousDecision !== null) edges.push({ from: previousDecision, to: id, kind: "spine" });
      previousDecision = id;
    }
    row += 1;

    const branches = kind === "decision"
      ? decisionBranches(proposal, tree.units)
      : proposal.alternatives.map((alternative, index) => ({
        id: `${id}:alt:${index}`, kind: "alternative" as NodeKind,
        label: line(alternative, 72), detail: alternative,
      }));
    for (const branch of branches) {
      nodes.push({ ...branch, column: 2, row, at: null, parent: id });
      edges.push({ from: id, to: branch.id, kind: "branch" });
      row += 1;
    }
  };

  const placed = new Set<string>();
  for (const ask of tree.asks) {
    const id = `ask:${ask.inputId}`;
    nodes.push({ id, kind: "ask", column: 0, row, label: line(ask.text, 64), detail: ask.text, at: ask.at, parent: null });
    row += 1;
    for (const decision of tree.spine) {
      if (decision.ask !== ask.inputId) continue;
      placed.add(decision.id);
      emitProposal(decision, id, "decision");
    }
    for (const proposal of tree.notTaken) {
      if (proposal.ask !== ask.inputId) continue;
      placed.add(proposal.id);
      emitProposal(proposal, id, "not-taken");
    }
  }

  // A proposal whose ask is unknown still belongs on the tree, hanging from
  // nothing rather than being dropped for having no parent to draw an edge to.
  for (const decision of tree.spine) if (!placed.has(decision.id)) emitProposal(decision, null, "decision");
  for (const proposal of tree.notTaken) if (!placed.has(proposal.id)) emitProposal(proposal, null, "not-taken");

  return {
    nodes, edges,
    columns: nodes.reduce((widest, node) => Math.max(widest, node.column + 1), 1),
    rows: row,
  };
}

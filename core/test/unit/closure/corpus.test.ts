import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { parse } from "yaml";
import { loadCatalog } from "../../../src/registry/catalog.ts";
import { planAgreement, type AgreementTicket, type PlanAgreementInput } from "../../../src/registry/plan-agreement.ts";
import { parseAwsfPlanHtmlV1, resolvePlanSources, scanAwsfPlanHtmlV1 } from "../../../src/registry/plan-source.ts";
import { closureDelta } from "../../../src/closure/delta.ts";
import { compareAskedFor, type AskedForSelection } from "../../../src/closure/asked-for.ts";
import { ticketFrontmatter, type ClosurePlanSource, type ClosureTree } from "../../../src/closure/tree.ts";
import { repoRoot } from "../meta/_walk.ts";

const root = repoRoot();
const catalogPath = join(root, "awsf.project.yaml");
const sources: readonly ClosurePlanSource[] = resolvePlanSources(catalogPath, loadCatalog(readFileSync(catalogPath, "utf8")))
  .map((source) => ({ ...source, label: basename(source.planPath, ".html"),
    planPath: relative(root, source.planPath), promptsPath: relative(root, source.promptsPath),
    ticketsPath: relative(root, source.ticketsPath) }));
const registry = { plans: sources };
const corpus = new Map<string, Uint8Array>();
for (const source of sources) {
  corpus.set(source.planPath, readFileSync(join(root, source.planPath)));
  if (!existsSync(join(root, source.ticketsPath))) continue;
  corpus.set(source.promptsPath, readFileSync(join(root, source.promptsPath)));
  for (const file of readdirSync(join(root, source.ticketsPath)).filter((name) => /^[TW]\d\d\.md$/u.test(name))) {
    const path = `${source.ticketsPath}/${file}`;
    corpus.set(path, readFileSync(join(root, path)));
  }
}
const text = (tree: ClosureTree, path: string): string => Buffer.from(tree.get(path)!).toString("utf8");

function replaceSpan(tree: ClosureTree, path: string, start: number, end: number, value: string): Map<string, Uint8Array> {
  const before = text(tree, path);
  assert.ok(start >= 0 && end >= start && end <= before.length, `${path}: invalid mutation span`);
  const after = new Map(tree);
  after.set(path, Buffer.from(before.slice(0, start) + value + before.slice(end)));
  return after;
}

/** Change exactly one ASCII byte, leaving length, UTF-8 and surrounding grammar intact. */
function oneByte(tree: ClosureTree, path: string, start: number, end: number): Map<string, Uint8Array> {
  const before = text(tree, path);
  const match = /[A-Za-z0-9]/u.exec(before.slice(start, end));
  assert.ok(match, `${path}: no mutable byte in ${start}..${end}`);
  const index = start + match.index;
  const after = replaceSpan(tree, path, index, index + 1, match[0] === "Z" ? "Y" : "Z");
  const left = corpus.get(path) === tree.get(path) ? corpus.get(path)! : Buffer.from(before);
  const right = after.get(path)!;
  assert.equal(left.length, right.length);
  assert.equal([...left].filter((byte, i) => byte !== right[i]).length, 1);
  return after;
}

function fieldChange(tree: ClosureTree, path: string, field: string): Map<string, Uint8Array> | undefined {
  const raw = text(tree, path);
  const fmEnd = raw.indexOf("\n---\n", 4);
  const match = new RegExp(`^${field}: (.*)$`, "mu").exec(raw.slice(0, fmEnd));
  if (match === null || !/[A-Za-z0-9]/u.test(match[1]!)) return undefined;
  return oneByte(tree, path, match.index + field.length + 2, match.index + match[0].length);
}

// This adapter deliberately follows the meta fence, not treeAgreement or its
// parsing helpers: the oracle is T03 called with the fence's own inputs.
function fenceInput(tree: ClosureTree, source: ClosurePlanSource): PlanAgreementInput {
  const tickets: AgreementTicket[] = [...tree.keys()]
    .filter((path) => path.startsWith(`${source.ticketsPath}/`) && /^[TW]\d\d\.md$/u.test(basename(path)))
    .sort().map((path) => {
      const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(text(tree, path));
      assert.ok(match, path);
      const fm = parse(match[1]!) as Record<string, unknown>;
      const split = match[2]!.split("## Build prompt\n\n");
      assert.equal(split.length, 2, path);
      return { id: String(fm.id), number: Number(String(fm.id).slice(1)), title: String(fm.title),
        milestone: String(fm.milestone), tier: fm.tier === undefined ? undefined : Number(fm.tier),
        state: String(fm.state), depends_on: (fm.depends_on as string[]) ?? [],
        workflow: fm.workflow === undefined ? undefined : String(fm.workflow), task_class: fm.task_class,
        serves: fm.serves as string[] | undefined, prompt: split[1]!.replace(/\n+$/u, "") };
    });
  const section = tree.has(source.promptsPath)
    ? text(tree, source.promptsPath).split("# Section B — Task prompts (recommended)")[1] ?? "" : "";
  const heads = [...section.matchAll(/^### T(\d+) — (.+)$/gm)];
  return { label: source.label, plan: parseAwsfPlanHtmlV1(text(tree, source.planPath), source.label), tickets,
    knownStems: sources.map((item) => item.label), sectionB: new Map(heads.map((head, i) => [Number(head[1]), {
      title: head[2]!.trim(), prompt: section.slice(head.index + head[0].length, heads[i + 1]?.index ?? section.length).trim(),
    }])) };
}

function refused(before: ClosureTree, after: ClosureTree, path: string): void {
  const result = closureDelta(before, after, registry);
  assert.equal(result.ok, false, `${path}: ${JSON.stringify(result)}`);
  if (result.ok) throw new Error("expected closure refusal");
  assert.equal(result.refusal.code, "E_CLOSURE_DELTA");
  assert.equal(result.refusal.path, path);
}

function askChanged(before: ClosureTree, after: ClosureTree, selection: AskedForSelection, field: string): void {
  const result = compareAskedFor(before, after, registry, [selection]);
  assert.equal(result.ok, false, `${JSON.stringify(selection)}: ${field}`);
  if (result.ok || result.refusal.code !== "E_CLOSURE_ASK_CHANGED") throw new Error(JSON.stringify(result));
  assert.ok(result.refusal.differences.some((difference) => difference.field === field), JSON.stringify(result));
}

function sampled<T>(values: readonly T[]): readonly T[] {
  return [...new Set([values[0], values[Math.floor(values.length / 2)], values.at(-1)])].filter((value) => value !== undefined) as T[];
}

test("closure corpus discovery covers every resolved source and rejects orphan ticket sets", () => {
  assert.ok(sources.length > 0);
  for (const ticketsRoot of new Set(sources.map((source) => dirname(source.ticketsPath)))) {
    for (const entry of readdirSync(join(root, ticketsRoot), { withFileTypes: true })) {
      if (entry.isDirectory()) assert.ok(sources.some((source) => source.ticketsPath === `${ticketsRoot}/${entry.name}`), entry.name);
    }
  }
  for (const source of sources) {
    const input = fenceInput(corpus, source);
    if (input.tickets.length > 0) assert.deepEqual(planAgreement(input), [], source.label);
  }
  assert.deepEqual(closureDelta(corpus, corpus, registry), { ok: true, changes: [] });
});

for (const source of sources) {
  test(`closure real corpus: ${source.label}`, (t) => {
    const started = performance.now();
    // All real plan files stay registered, preserving qualified-stem resolution.
    // Only this source's tickets participate in each sweep; the full-tree test
    // above proves the other sets agree. No source is omitted, including v1.
    const before = new Map([...corpus].filter(([path]) => sources.some((item) => item.planPath === path)
      || path === source.promptsPath || path.startsWith(`${source.ticketsPath}/`)));
    const input = fenceInput(before, source);
    const html = text(before, source.planPath);
    const layout = scanAwsfPlanHtmlV1(html);
    const allTokens = [...layout.milestones, ...layout.tasks.flatMap((task) => task.tokens)];
    // Status sampling is explicitly permitted by T05: first/middle/last
    // milestone and first/middle/last checklist token. Ticket states are exhaustive.
    const tokens = [...sampled(layout.milestones), ...sampled(layout.tasks.flatMap((task) => task.tokens))];
    let flips = 0;
    let accepted = 0;
    let denied = 0;
    let askMutations = 0;
    const classes = new Set<string>();
    const checkFlip = (after: ClosureTree, oracle: PlanAgreementInput, path: string): void => {
      const violations = oracle.tickets.length > 0 ? planAgreement(oracle) : [];
      const delta = closureDelta(before, after, registry);
      assert.equal(delta.ok, violations.length === 0, `${source.label}: ${path}: ${JSON.stringify({ delta, violations })}`);
      if (!delta.ok) assert.equal(delta.refusal.kind, "agreement");
      flips++;
      if (delta.ok) accepted++; else denied++;
    };
    for (const token of tokens) {
      for (const value of ["", "wip", "x"]) {
        const after = replaceSpan(before, source.planPath, token.valueStart, token.valueEnd, value);
        checkFlip(after, { ...input, plan: parseAwsfPlanHtmlV1(text(after, source.planPath), source.label) }, source.planPath);
      }
      for (const value of ["f", "unknown"]) refused(before,
        replaceSpan(before, source.planPath, token.valueStart, token.valueEnd, value), source.planPath);
    }
    for (const ticket of input.tickets) {
      const path = `${source.ticketsPath}/${ticket.id}.md`;
      const raw = text(before, path);
      const fm = ticketFrontmatter(raw, path);
      const selection: AskedForSelection = { kind: "plan", plan: source.label, ticket: ticket.id };
      for (const value of ["todo", "wip", "done"]) {
        const after = replaceSpan(before, path, fm.stateStart, fm.stateEnd, value);
        checkFlip(after, { ...input, tickets: input.tickets.map((item) => item.id === ticket.id ? { ...item, state: value } : item) }, path);
        assert.equal(compareAskedFor(before, after, registry, [selection]).ok, true);
      }
      for (const value of ["failed", "unknown"]) refused(before, replaceSpan(before, path, fm.stateStart, fm.stateEnd, value), path);
      for (const field of ["title", "milestone", "depends_on", "serves"]) {
        const after = fieldChange(before, path, field);
        if (after === undefined) continue; // empty/absent legacy fields have no value byte
        refused(before, after, path);
        askChanged(before, after, selection, field);
        classes.add(field); askMutations++;
      }
      const promptStart = raw.indexOf("## Build prompt\n\n") + "## Build prompt\n\n".length;
      const prompt = oneByte(before, path, promptStart, raw.length);
      refused(before, prompt, path); askChanged(before, prompt, selection, "prompt");
      classes.add("ticket prompt"); askMutations++;
      // Empty and legacy-absent Handoffs get findings only in an in-memory
      // baseline, then exactly one finding byte is changed. The ask is constant.
      const handoffStart = raw.indexOf("## Handoff\n");
      const handoffBase = replaceSpan(before, path, handoffStart < 0 ? promptStart - "## Build prompt\n\n".length : handoffStart,
        handoffStart < 0 ? promptStart - "## Build prompt\n\n".length : handoffStart + "## Handoff\n".length,
        "## Handoff\n\nCorpus findings.\n\n");
      const findings = text(handoffBase, path).indexOf("Corpus findings.");
      const handoff = oneByte(handoffBase, path, findings, findings + "Corpus findings.".length);
      refused(handoffBase, handoff, path);
      assert.equal(compareAskedFor(handoffBase, handoff, registry, [selection]).ok, true);
      classes.add("Handoff");
      const task = layout.tasks.find((item) => item.number === ticket.number)!;
      assert.ok(task, `${path}: task missing`);
      for (const token of task.tokens) {
        // Row prose after the token, ignoring tags. This covers every ticket's
        // acceptance rows, while status-value sweeps remain sampled per plan.
        const rowEnd = html.indexOf("</li>", token.end);
        const end = rowEnd >= 0 && rowEnd < task.end ? rowEnd : html.indexOf("\n", token.end);
        const prose = /(?:^|>)([^<>]*[A-Za-z][^<>]*)(?:<|$)/u.exec(html.slice(token.end, end));
        assert.ok(prose, `${path}: no acceptance prose`);
        const start = token.end + prose.index + (prose[0].startsWith(">") ? 1 : 0);
        const after = oneByte(before, source.planPath, start, start + prose[1]!.length);
        refused(before, after, source.planPath); askChanged(before, after, selection, "checklist");
        classes.add("acceptance row"); askMutations++;
      }
      // Every task token is ignored by its selected ticket's ask, not just the sample.
      let statusOnly: ClosureTree = before;
      for (const token of [...layout.milestones, ...task.tokens].sort((a, b) => b.valueStart - a.valueStart)) {
        statusOnly = replaceSpan(statusOnly, source.planPath, token.valueStart, token.valueEnd, token.value === "x" ? "wip" : "x");
      }
      assert.equal(compareAskedFor(before, statusOnly, registry, [selection]).ok, true);
    }
    if (input.tickets.length > 0) {
      const section = text(before, source.promptsPath);
      const start = section.indexOf("# Section B — Task prompts (recommended)");
      assert.ok(start >= 0);
      const prompt = /\n```\n([\s\S]*?)\n```/u.exec(section.slice(start));
      assert.ok(prompt);
      const promptStart = start + prompt.index + "\n```\n".length;
      refused(before, oneByte(before, source.promptsPath, promptStart, promptStart + prompt[1]!.length), source.promptsPath);
      classes.add("Section B prompt");
    }
    const spine = /<section\b[^>]*\bid="spine"[^>]*>([\s\S]*?)<\/section>/u.exec(html);
    if (spine !== null) {
      for (const declaration of spine[0].matchAll(/<dd>([\s\S]*?)<\/dd>/gu)) {
        const statementStart = spine.index + declaration.index + "<dd>".length;
        const prose = /(?:^|>)([^<>]*[A-Za-z][^<>]*)(?:<|$)/u.exec(declaration[1]!);
        assert.ok(prose);
        const start = statementStart + prose.index + (prose[0].startsWith(">") ? 1 : 0);
        const after = oneByte(before, source.planPath, start, start + prose[1]!.length);
        refused(before, after, source.planPath);
        if (input.tickets[0] !== undefined) askChanged(before, after,
          { kind: "plan", plan: source.label, ticket: input.tickets[0].id }, "declarations");
        classes.add("declaration statement"); askMutations++;
      }
    }
    const metadata = /<dt>[^<]*created[^<]*<\/dt>\s*<dd>([^<]+)<\/dd>/u.exec(html);
    assert.ok(metadata, `${source.label}: missing metadata row`);
    const metadataStart = metadata.index + metadata[0].indexOf(metadata[1]!);
    refused(before, oneByte(before, source.planPath, metadataStart, metadataStart + metadata[1]!.length), source.planPath);
    classes.add("metadata row");
    const added = new Map(before); added.set("corpus-added.txt", Buffer.from("x"));
    refused(before, added, "corpus-added.txt");
    const removed = new Map(before); removed.delete(source.planPath);
    refused(before, removed, source.planPath);
    const modes = new Map([...before.keys()].map((path) => [path, "100644"]));
    const changedModes = new Map(modes); changedModes.set(source.planPath, "100755");
    assert.equal(closureDelta(before, before, registry, { before: modes, after: changedModes }).ok, false);
    assert.ok(accepted > 0, `${source.label}: no positive delta case`);
    if (input.tickets.length > 0) assert.ok(denied > 0, `${source.label}: no agreement refusal`);
    t.diagnostic(JSON.stringify({ plan: source.label, tickets: input.tickets.length, statusTokens: allTokens.length,
      sampledStatusTokens: tokens.length, flips, accepted, agreementRefusals: denied, askMutations,
      refusedByteClasses: [...classes].sort(), absentLegacyClasses: ["serves", "declaration statement", "depends_on"]
        .filter((value) => !classes.has(value)), elapsedMs: Math.round(performance.now() - started) }));
  });
}

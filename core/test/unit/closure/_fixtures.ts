import type { ClosureRegistry } from "../../../src/closure/tree.ts";

export const PLAN = "plans/sample.html";
export const TICKET = "paired/source/T01.md";
export const PROMPTS = "prompts/source.md";
export const LIGHT = "flat/T02.md";
export const registry: ClosureRegistry = {
  plans: [{ label: "sample", project: "sample", repositoryId: "plan", format: "awsf-plan-html/v1",
    planPath: PLAN, promptsPath: PROMPTS, ticketsPath: "paired/source" }],
};
export const plan = `<section id="spine"><dt><code class="inv">INV-1</code></dt><dd>The ask stays fixed.</dd></section>
<section id="phases">
<h3><code class="status">[]</code> Milestone M1: One</h3>
<h4>1. A task</h4>
<p>Serves <code class="serves">INV-1</code></p>
<ul><li><code class="status">[]</code> Acceptance row.</li></ul>
</section>
<p><code class="status">[]</code> An example outside the parser.</p>`;
export const ticket = `---
id: T01
title: A task
milestone: M1
state: todo
depends_on: []
workflow: build-review
serves: [INV-1]
---
# Ticket

## Handoff

Old findings.

## Build prompt

\`\`\`
Build the task.
\`\`\`
`;
export const prompts = `# Section B — Task prompts (recommended)
### T01 — A task

\`\`\`
Build the task.
\`\`\`
`;
export const light = `---
id: T02
title: Light work
milestone: M1
tier: 0
state: todo
depends_on: []
workflow: build-review
outcome: A fixed outcome
context: [A fixed context]
acceptance: [A fixed acceptance]
non_goals: []
---
Body of the light ask.

## Handoff

Old findings.
`;
export function tree(includeLight = false): Map<string, Uint8Array> {
  const result = new Map([[PLAN, Buffer.from(plan)], [TICKET, Buffer.from(ticket)], [PROMPTS, Buffer.from(prompts)],
    ["untouched.bin", Buffer.from([255, 0, 128])]]);
  if (includeLight) result.set(LIGHT, Buffer.from(light));
  return result;
}
export function change(input: ReadonlyMap<string, Uint8Array>, path: string, from: string, to: string): Map<string, Uint8Array> {
  const result = new Map(input);
  const text = Buffer.from(result.get(path)!).toString("utf8");
  if (!text.includes(from)) throw new Error(`fixture missing ${from}`);
  result.set(path, Buffer.from(text.replace(from, to)));
  return result;
}
export const lightRegistry: ClosureRegistry = { ...registry, lightTickets: new Map([["T02", LIGHT]]) };

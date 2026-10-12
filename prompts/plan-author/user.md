Author the requested deep plan for the single sealed Wnn spine ticket. Read its registered plan source, prompt, dated Handoff and dated Amendments before writing; more recent recorded facts win.

Previous host envelope:
{previous_envelope}

Write exactly plan.html, build-prompts.md and tickets.json in the session-runtime output directory the host names. Return only a small envelope naming them through runtimeFiles and a new lowercase hyphenated stem. artifacts must be []. Do not embed document contents in the envelope, claim a SHA, or write any repository file. The envelope is limited to 65,536 UTF-8 bytes; plan.html and build-prompts.md to 2,097,152 bytes each; tickets.json to 262,144 bytes. There are 1..99 tickets.

Plan grammar (awsf-plan-html-v1):
- Use a complete HTML document with the repository's Forest stylesheet and the existing PLAN-SOTA REVIEW LAYER v1 style/script copied verbatim from a reference plan. The browser layer proposes statuses; it never changes canonical markers.
- Include header/metadata and back/forward references, In Plain Language, Purpose, Problem, Solution, Relevant Files, Identifier Spine, Execution/owner gates/fences, Implementation Phases, Validation Commands, Questionables, Notes and Amendments. Explain what each phase earns and what remains owner-side.
- Under Implementation Phases, each .phase has an h3 with `<code class="status">[]</code> Milestone M1: ...` (then M2, etc.). Tasks use h4 `1. Title`, increasing without gaps. Each task has a nonempty ul.checklist whose li rows each contain exactly one idle status token. Every marker is `<code class="status">[]</code>`; authoring earns no marker, including approvals.
- Identifier Spine uses dt `<code class="inv">INV-1</code>` and `<code class="ac">AC-1</code>` with nonempty dd statements. IDs are unique, declared once and served by at least one task. Each task's Serves line uses `<code class="serves">ID</code>` and matches the table's serves set. No undeclared or orphan identifier. Preserve all spine commitments the request carries.
- Match the title, milestone and task coverage in the table. Dependencies name earlier tasks only and are real prerequisites, with no cycles. Owner protected-path work is explicitly separated from builder work.

Canonical build prompts:
- Section A records shared conventions and write boundaries. Use exactly one `# Section B — Task prompts (recommended)` heading, then one `### T01 — Title` block per task through Tnn, with a fenced, self-contained build prompt.
- State scope, predecessors, baseline, READ FIRST, DO, DO NOT, builder-ready checks, owner acceptance, proposed commit, owner-side markers and dated handoff requirements. No credential-shaped example or identity attribution.
- Section B is the single prompt source. The host derives ticket bodies byte-for-byte from these blocks: do not separately write tickets. Any Handoff section in a ticket must sit above `## Build prompt`, never inside or after the authoritative prompt.

Frontmatter table:
- tickets.json is a JSON array in ordered T01..Tnn order. Each row has id, title, milestone, depends_on and serves; optional tier (0..2), workflow and task_class. No path, prompt, body, Handoff, state or additional field. The host owns state and derives every state as todo.
- All plan markers idle and all derived states todo; do not predeclare completed work. A new stem creates exactly its plan, build prompts, ticket README and tickets. Any existing stem/path, non-idle marker, supplied state, or disagreement is refused before commit.

The host admits, tests and obtains a cross-provider review of the exact candidate. It never modifies an existing protected path. The owner later reviews the plan, lands it as approval and chooses its authored-and-approved spine row in awsf close; prose cannot identify or close a row.

Output contract:
{output_schema}

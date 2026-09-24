---
description: Prime an AWSF driving session — the judgment layer plus live facts from the code
---
# /prime-awsf

Orient a driving session: the tier above the factory, where the owner decides
what to ask for, prepares it, launches it, watches it and reads what came back.
Load exactly what follows. Every item is a single source or printed from the
code; nothing here restates one, because a copy goes wrong quietly. Paths
starting `../` are relative to this file; every other path and every command is
from the checkout root.

Already in your context — do not re-read: `AGENTS.md` (project instructions)
and, in a marimba session, `../marimba/CONTRACT.md` (system prompt).

## 1. Read, in this order

1. `../skills/awsf/SKILL.md` — posture, owner acts, hard rules, and
   the routes table. Read the table now; read a cookbook only when a request
   calls for it.
2. `../skills/awsf/cookbooks/run_and_observe.md` — launching and
   watching a run.
3. `../skills/awsf/references/gotchas.md` — every trap measured so
   far.
4. `../skills/marimba-plan/SKILL.md` — the group journal.

These four are also what a marimba session reloads after a compaction.

## 2. Print the live facts

Current by construction: recipes, phases, minimum calls and tier ceilings;
adapters, efforts and routable phase ids; the group operations and their flags;
every lifecycle edge with its actors, spawn site and interactivity; the v2
milestone markers.

```bash
npm run awsf --silent -- workflows
npm run awsf --silent -- routes list 2>&1
npm run awsf --silent -- group help
grep -E '^\s*\{ id: "L[0-9]+"' core/src/state/task-machine.ts
grep -E '<h3><code class="status">' specs/awsf-v2-plan.html | sed -E 's/<[^>]+>//g; s/^ +//'
```

`just awsf X` in any driving document is `npm run awsf -- X`; use the npm form
when `just` is not installed.

## 3. Preflight — unless the owner waives it

```bash
npm install --no-audit --no-fund 2>&1 | tail -n 1
npm test 2>&1 | grep -E '^# (tests|pass|fail) |^layers|^not ok'
npm run lint 2>&1 | tail -n 2
npm run awsf --silent -- doctor 2>&1 | grep -vE 'recovery: no live controller|candidate: none'
```

Report any red before driving: a red base blocks a correct build. `doctor` is
read-only and has no repair path; a finding is evidence for the owner, never
permission to alter an attempt.

## 4. Look up on demand, never preload

- guards, tiers, the phase machine, error classes: `core/src/state/`, mapped
  question by question in `../skills/awsf/references/lifecycle.md`
- where evidence lives: `../skills/awsf/references/evidence_map.md`
- committed tuning: `awsf.config.yaml`, validated by `core/src/config/schema.ts`
- a workstream's scope and decisions: its deep plan `specs/awsf-v2-w*.html`.
  `specs/awsf-plan.html` is v1 and complete: open its Amendments only to learn
  why a v1 edge exists.

## 5. Then stop

Do not print a status board: state volunteered before a request is stale on
arrival, and a file that shows it breaks `AGENTS.md` invariant 1. Read state
when a request needs it, for the task the owner names. Say you are primed in
one line.

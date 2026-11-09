---
description: Prime an AWSF driving session — the judgment layer plus live facts from the code
---
# /prime-awsf

Orient the driving session without starting a task. Load the judgment layer and
print facts from their sources. Paths starting `../` are relative to this file.
Other paths and commands are relative to the checkout root.

Confirm that the current `AGENTS.md` and `../marimba/CONTRACT.md` are loaded.
If either is absent or stale, read it. A missing guard makes this a read-only
session. Do not infer that a launcher supplied it from the launcher's name.

## 1. Read, in this order

1. `../skills/awsf/SKILL.md` for posture, boundaries and the cookbook routes.
2. `../skills/awsf/cookbooks/run_and_observe.md` for preparation, owner launch
   and observation.
3. `../skills/awsf/references/gotchas.md` for live traps and historical repairs.
4. `../skills/marimba-plan/SKILL.md` for the group journal.

These four are also the repository profile's re-prime pack after compaction.
Priming does not survive compaction unless its sources have been reloaded.

## 2. Print the current facts

Print the workflow catalogue, route vocabulary, group operations, lifecycle
edges and current v3 milestone markers:

```bash
npm run awsf --silent -- workflows
npm run awsf --silent -- routes list
npm run awsf --silent -- group help
grep -E '^\s*\{ id: "L[0-9]+"' core/src/state/task-machine.ts
grep -E '<h3><code class="status">' specs/awsf-v3-plan.html
```

Use the v2 spine only for work that belongs to it or historical context.
`just awsf X` in a driving document means `npm run awsf -- X`. Use npm when
`just` is not installed. Do not carry a model list or copied ceiling into the
session as current authority.

## 3. Verify the base unless the owner waives this orientation check

Dependencies must already be installed. Missing dependencies are a setup stop,
not permission for the driver to rewrite dependency files.

```bash
npm run lint
npm run typecheck
npm test
npm run awsf --silent -- doctor
```

Run each command separately and retain its original exit code. Do not pipe a
command into a filter and report the filter's success as the command's result.
Report the tested revision or tree and measured totals. The root suite runs
unit, contract, simulation, journeys and traps.

Report red before driving. `doctor` is read-only and has no repair path. A
finding is evidence for the owner, never permission to alter an attempt. An
owner waiver here cannot waive a later task's mandatory host preflight,
confirmation, closure or configured gates.

## 4. Look up on demand

- Lifecycle rules: `core/src/state/`, mapped by
  `../skills/awsf/references/lifecycle.md`.
- Evidence locations and read boundaries:
  `../skills/awsf/references/evidence_map.md`.
- Execution configuration: `awsf.config.yaml`. Project registration and gates:
  `awsf.project.yaml` and the machine-local placement.
- Workstream scope: its registered deep plan, Section B prompt and ticket.
  The current v3 deep plans use `specs/awsf-v3-w*.html`.
- Repository reference: the [documentation map](../../README.md) distinguishes
  current guidance from historical records.

Do not preload closed plans or rewrite their recorded evidence.

## 5. Then stop

Do not print an unrequested runtime status board. Read state when the owner's
request requires it, for the named task. Say you are primed in one line.

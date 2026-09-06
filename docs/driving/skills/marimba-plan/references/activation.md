# Activation and compatibility

This directory is an installable Agent Skills package. No global installation is
required. For Pi, add this argument to an existing guarded marimba launch:

```text
--skill "$MARIMBA_CHECKOUT/docs/driving/skills/marimba-plan"
```

Keep its existing `-e` guard extension, excluded delegation tools and appended
marimba contract. Do not launch a bare unguarded replacement, edit shell profiles,
or change shared routing defaults. Activate with `/skill:marimba-plan` in that
session. Pi discovers the name/description first and loads the body on demand.
Other compatible harnesses can load the same directory through their explicit
skill mechanism, subject to their existing guard. Such harnesses need their own
installation check. The repository itself installs nothing into auto-discovered
worker directories.

Registered plan compatibility remains `awsf-plan-html/v1`, resolved through
`core/src/registry/plan-source.ts`. Host rendering remains
`core/src/registry/plan-render.ts`, including combined Section B build prompts and
byte-matched ticket prompts. No new repository-native format or plan migration is
introduced. Planning records never update registered status markers.

For a unit tied to a registered ticket, specify its `plan` object with catalog
path, plan stem, task id and SHA-256 of the registered HTML source. The read-only
join resolves through the catalog and refuses missing or mismatched sources. A
landing cannot make its checklist row done while the registered plan/ticket still
says unfinished. Updating registered artifacts remains their existing authorized
workflow, with the synchronization fence unchanged.

The group journal is the foundation shared with the future group timeline UI.
This slice supplies exact inputs, append stages, units, amendments, closure and
explicit unit-revision/attempt bindings. It does not finish all of Task 3:
creation-time `awsf new --group` plumbing, the sessions `group_id` projection/public
query, and continuation relationship backfill still require implementation.
Group membership and continuation are different relationships. Do not infer either
from timing, task order or proximity. Cross-group continuation is not implemented
by copying an attempt into another group.

Per-phase model/effort choice, the harness, canvas and visual editor are excluded.
The skill does not alter mandatory priming, execution gates or accounting. A future
screen may render checklist data but may not treat a displayed value as an owner
lifecycle authorization.

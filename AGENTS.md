# AGENTS.md

Invariants for any agent session working **on** AWSF (not workflows AWSF *runs* —
this repository's own build). Breaking one of these is a defect in the session,
not a judgement call. Several are mechanically enforced by meta-tests under
`core/test/unit/`; enforcement is noted where it exists.

1. **No live task state, ever.** This repository, its docs, and its commits never
   encode which task/attempt/session is currently running. That state lives only
   in the journal and status store at runtime, never in a committed file.
2. **No status marker is flipped for work not completed in that session.**
   `specs/awsf-plan.html` markers (`[]`/`[wip]`/`[x]`/`[f]`) are earned, not
   pre-declared.
3. **`node:child_process` is imported nowhere except
   `core/src/execution/transport-broker.ts`.** Enforced by the child-process
   fence meta-test.
4. **No `shell: true`, anywhere.** Executable + argv array only. Enforced by the
   no-`shell:true` meta-test.
5. **`core/src/state/**` imports nothing impure** — no I/O, no clock, no
   `child_process`, no filesystem. Enforced by the state-purity fence meta-test.
6. **SQLite is written only by `core/src/observability/{sqlite.ts, projector.ts}`
   and the files under `core/src/observability/migrations/`.** Enforced by the
   sqlite-write fence meta-test.
7. **No dependency beyond the allowlist** (D2): core = `@sinclair/typebox`,
   `yaml`; dashboard = `vue`, `vite`, `@vitejs/plugin-vue`, `lucide-vue-next`;
   dev = `typescript`, `vue-tsc`, `oxlint`. Enforced by the dependency-allowlist
   meta-test.
8. **No push, force, or auto-delete path exists anywhere in `core/src`.**
   Landing is local fast-forward only; `awsf gc` lists, never deletes. Enforced
   by the no-push/no-destructive-paths and no-land-route meta-tests.
9. **No credential-shaped value is committed, in fixtures or anywhere else.**
   Enforced by the credential-pattern meta-test.
10. **No runtime artifact, receipt, or manifest file is committed.** Git and the
    journal are the only evidence store; a `*receipt*` or `*manifest*` file
    landing in the repo is a bug. Enforced by the junk-drawer meta-test.
11. **No commit ever names an agent, model, or AI tool as author, committer,
    co-author, or collaborator.** Not `git config user.name`/`user.email` at
    commit time, not a `Co-Authored-By` trailer, not a GitHub collaborator
    invite. Every commit's author and committer identity is the owner's own
    (`Santiago Marin <santiagomarinsuarez@me.com>`), full stop — a session
    must never let its own default git identity leak into a commit. A
    session's own completion metadata (agent name, session id,
    `built on: <provider>:<model>`) belongs only in the plan's
    `<dl>`/Amendments, never in the commit itself. Enforced by the
    no-agent-coauthor meta-test, which scans this repository's own commit
    history (author, committer, and message trailers alike).
12. **`specs/tickets/` and `specs/awsf-plan.html` never disagree.** The plan's
    status markers are the source of truth; a ticket's `state` mirrors them and
    is flipped in the *same commit*, never a later one. A ticket's build prompt
    stays byte-identical to its `awsf-plan-build-prompts.md` § Section B block —
    the tickets are a re-cut of that file, never a fork of it. Enforced by the
    ticket/plan-sync meta-test: task coverage, milestone grouping, `state`
    against both the milestone marker and the task's own checklist, prompt and
    title integrity, `depends_on` ordering, and the frontmatter vocabularies.

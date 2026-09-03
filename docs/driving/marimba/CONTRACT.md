# marimba's operating contract

## 1. The role

marimba is the **driving** role. It operates AWSF through its CLI: it prepares
work, launches runs, reads the journal and the status store, and hands the owner
what a decision needs.

One line separates it from worker work: **marimba never does the work itself.**
It does not implement a task, does not edit a managed worktree, and does not
hand-edit anything under the state root. Workers do that inside attempts.

## 2. The boundary

marimba runs with permission prompts turned off, so what keeps it inside the
lifecycle is a **denial at the tool surface**, from a hook delivered **per
invocation** with marimba's own settings. Two fences:

- **Fence 1 — delegation-shaped tool NAMES.** Denied, so a driving session
  cannot create work the factory has no attempt directory, journal record,
  reserved call or gate for. Classification is by shape, not a fixed list, so a
  delegation tool that did not exist when the fence was written is denied on
  arrival. Observe-or-stop tools are excluded by whole name.
- **Fence 2 — owner-act command TEXT.** A shell command invoking one of the acts
  the lifecycle reserves for the owner is denied through any wrapper, whitespace
  normalised before matching.

If the payload parser cannot run at all, the guard fails closed and says so.

## 3. What the boundary does not cover

The part this document exists for. Every item was measured against the guard as
committed.

1. Fence 2 reads **written command text, not resolved intent**: an act reached
   through a variable, a line continuation, a quoted or split verb, or an inner
   backslash is not denied. Whitespace is the only shell transformation it
   undoes, so the gap is a class and is stated rather than closed.
2. Fence 2 **over-denies** in the other direction: a command that merely reads
   or quotes an act name is refused as though it had invoked one.
3. The guard **does not protect its own files**: a write aimed at its own script
   is allowed, because fence 2 only ever looks at a command field.
4. Tool names belonging to an MCP server are **never classified** by fence 1,
   because an MCP server chooses its own nouns.
5. A payload the parser **rejects** fails open, deliberately: failing closed
   would break every tool call the day the harness changes its payload shape.
6. A session launched **without marimba's settings** carries no guard, and
   nothing inside it announces that afterwards — hence the session-start banner.
7. None of this **confines what a session reads, writes or runs**: path policy
   governs worker phases and does not apply to the driving session.

That list is the operating envelope, not a menu. A session that decides to
route around the fences can; what the boundary buys is that doing so is a
**choice** and never an accident.

## 4. How marimba's settings load

Measured, and worth knowing because it decides what else is in scope:

- `--settings` **merges** marimba's settings with those already in scope. It
  excludes nothing.
- `--setting-sources` is the flag that **excludes**. marimba does not use it.
- A project's own `PreToolUse` hook returning *allow* for a call the guard denies
  **does not override the deny** — measured, with the project hook proven to
  have run.
- A project settings file's `permissions.allow` list is a **different mechanism,
  untested**; nothing here claims it loses to the deny.

## 5. The architecture-review exception

A session launched without marimba's settings keeps the delegation tools, and
that is the supported route for a review by an agent that did not write the
proposal. Such a session reviews rather than drives: it reads, judges and
reports, and takes no owner act.

## 6. What is true instead

Four guarantees — earlier documents claimed stronger things that were not true.

1. **No push path exists** anywhere in the codebase.
2. **Nothing is auto-deleted.** The collection command lists, never removes.
3. **Writes during a worker phase are confined to a managed worktree** by path
   policy, with protected paths as an independent rejection on top.
4. **Canonical movement happens only through a local fast-forward the owner
   authorises.**

One placement fact, because getting it wrong makes guarantee 3 false: the
managed worktree root is a **sibling** of the state root, not inside it.

## 7. What marimba does instead of an owner act

**Prepare and explain.** Never perform one, and never recommend one without the
evidence its edge requires.

## 8. This document's own rule

**No live task state, ever.** This text names no task, attempt, session or run,
carries no continuity locator and no machine path, and no example may introduce
one. The same rule governs everything marimba writes into a committed file:
which work is running lives in the journal and the status store, nowhere else.

## 9. Handing off to a new session

A driving session may start ONE new session, only through
`docs/driving/marimba/handoff.sh`, which takes a handoff file under
`~/.local/state/marimba-handoffs/` and a variant name from its own table.

Use it when the next work is **not** a continuation. Continuations, reworks and
fixes stay in this session, where the findings already are.

The wrapper fixes the argv, so a spawned session always carries these settings,
this contract and both fences. Composing a launch argv, or writing into a pane
with `herdr agent send` or `pane run`, breaks that and is never sanctioned:
`processOwnerTerminal()` is a terminal-shape check, so whatever can type into a
terminal can answer an owner confirmation.

**A handoff carries facts with their sources, never conclusions.** Every claim
gets a `file:line`, because the receiving session is told to verify and can only
do that against a source.

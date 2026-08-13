# T30 Pilot 2 — Herdr-visible Fusion Harness journey

This script was authored before the build. Execute every step from the AWSF-managed candidate
worktree in the real Herdr workspace, never from either canonical `main`. Before beginning, run
`git rev-parse HEAD` and retain the resulting full candidate SHA. Every observed row below must
be completed with that same SHA; stop if HEAD changes or the worktree becomes dirty.

For interactive slash-command steps, launch the candidate's `bin/mf` from its worktree with the
normal `claude:opus` left route and `codex:gpt-5.6-sol` right route. Use only harmless prompts and
the reviewed subscription routes. Do not authorize a credit-billed model, provider fallback,
credential access, external mutation, deletion, or a push.

## 1. `/opinion`: one tab, two source panes

1. **Command:** In the candidate `mf` TUI, run `/opinion Reply with your role name and the word visible.`
2. **Expected observation:** One newly labelled tab appears in the current Herdr workspace. It
   has exactly two persistent panes: the `/ARCHITECT`-family Claude route on the left and the
   `/BUILDER` Pi-Codex route on the right. Both real source processes are visible and tracked;
   the parent waits and then renders the existing opinion panel. No hidden duplicate launches
   appear.
3. **Observed observation:** _Owner fills after execution._
4. **Exact checkout SHA:** _Owner fills from the exercised checkout._

## 2. `/fusion`: fuser reuses the left pane

1. **Command:** In the same candidate TUI, run `/fusion Produce a two-sentence plan for adding a harmless fixture test.`
2. **Expected observation:** A distinct newly labelled tab contains the same two source panes.
   Exactly two source calls run. After both validated envelopes settle, the Claude-family fuser
   runs as the third and final call by reusing the left pane; its prior scrollback remains
   inspectable. The right pane is retained. The parent renders the existing fused panel with
   explicit Herdr visibility metadata and no duplicate child.
3. **Observed observation:** _Owner fills after execution, including the retained artifact directory._
4. **Exact checkout SHA:** _Owner fills from the exercised checkout._

## 3. `/fusion-resume`: left pane only, no source rerun

1. **Command:** Using the retained successful source artifacts from step 2 as `<artifact-dir>`,
   run `/fusion-resume <artifact-dir> --approved-one-fuser-call`.
2. **Expected observation:** A distinct retained tab is inspectable; only its left pane runs the
   approved Claude-family fuser. The source providers do not rerun, the right pane launches no
   process, and accounting shows exactly one fuser call and zero source calls.
3. **Observed observation:** _Owner fills after execution._
4. **Exact checkout SHA:** _Owner fills from the exercised checkout._

## 4. `/auto-validate`: pane reuse across rounds

1. **Command:** In the candidate's reviewed managed Herdr host, run
   `/auto-validate --max-validations 2 Add the candidate's documented harmless fixture-only journey marker and satisfy its pinned fixture gate.`
2. **Expected observation:** One uniquely labelled retained tab reuses panes by provider and
   role across builder, validator, and any triage round. Every counted call is visible and
   attributed to its route. The parent remains blocked until the normal result and unchanged
   final panel are available. No background duplicate or fallback appears.
3. **Observed observation:** _Owner fills after execution, including calls by role and round._
4. **Exact checkout SHA:** _Owner fills from the exercised checkout._

## 5. Escape cancellation kills the pane-owned trees

1. **Command:** Start the candidate's documented process-backed long-running fixture journey in
   a fresh Fusion Harness command tab; while both pane-owned fixture providers are active, press
   Escape once in the parent TUI.
2. **Expected observation:** The real pane-owned provider process trees, including descendants,
   terminate. The parent reports the actual survivor list. No replacement provider process or
   hidden child appears. The cancelled tab and both panes remain inspectable and are not closed.
3. **Observed observation:** _Owner fills after execution, including survivor report and process census._
4. **Exact checkout SHA:** _Owner fills from the exercised checkout._

## 6. Herdr registration or IPC failure spends zero calls

1. **Command:** Run the candidate's documented fixture journey with its Herdr registration/IPC
   failure injection enabled, using the same harmless `/opinion` request.
2. **Expected observation:** The command fails before either provider release point. The fixture
   call counter remains zero, no provider process starts, no embedded/background fallback is
   selected, and the failed tab remains inspectable.
3. **Observed observation:** _Owner fills after execution, including the zero-call counter._
4. **Exact checkout SHA:** _Owner fills from the exercised checkout._

## 7. Explicit embedded mode outside Herdr

1. **Command:** From a terminal deliberately outside a Herdr registration, launch the candidate's
   `bin/mf` and run `/opinion Reply with the word embedded.`
2. **Expected observation:** The existing mode still works and is explicitly labelled embedded,
   not visible. No Herdr tab or pane is claimed, and no inference treats a background process as
   visible. The normal opinion panel remains unchanged apart from truthful visibility metadata.
3. **Observed observation:** _Owner fills after execution._
4. **Exact checkout SHA:** _Owner fills from the exercised checkout._

## 8. Retention and concurrent isolation

1. **Command:** Return to the real Herdr workspace, inspect the completed, failed, and cancelled
   tabs from steps 1–6, then start two candidate fixture commands concurrently using the
   documented concurrency journey.
2. **Expected observation:** Prior completed, failed, and cancelled tabs and scrollback remain
   inspectable; nothing auto-closes or deletes them. Concurrent commands receive distinct run
   IDs, tab labels, pane labels, IPC channels, and retained artifact locations, with no stream
   or cancellation cross-talk.
3. **Observed observation:** _Owner fills after execution, including both run IDs and isolation evidence._
4. **Exact checkout SHA:** _Owner fills from the exercised checkout._

## Attestation boundary

Do not attest this journey unless all eight observed fields are complete and every SHA resolves
to the exact AWSF candidate exercised above. The owner, not the driving session, runs
`awsf journey` at an interactive TTY after checking those facts.

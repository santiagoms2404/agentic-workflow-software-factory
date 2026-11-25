# Design contract brainstorm, 2026-11-24

**Status:** brainstorm record. Nothing in this file is a rule. A rule changes only by an owner commit through gate GA of `specs/awsf-v3-plan.html`.

**Written:** 2026-11-24, in a direct session with the owner, after the owner ruled on Q75 to Q104 and asked for the record and the frozen frames. A second round the same day ruled on Q105 to Q116 (sections 7 and 13). **To resume work, read sections 2, 6 and 11 first.**

**Follows:** `specs/brainstorms/2026-11-23-meta-factory.md`. The codes K27+, C25+, G29+, Q74+ and P14+ continue its series. DF, DC and ST are new here.

**Captured:** the owner said on 2026-11-24 that every question is answered and everything is settled. The canvas is settled at version 52 (U2). Nothing in this file waits for a ruling.

**Design reference:** the Marimba Harness Panel canvas, version 52, 100 boards (private to the owner, linked from the frame index). A second canvas, version 32, holds 27 boards generated from it. Only the first is edited.

## How to read this

| Code | Meaning |
| --- | --- |
| Q | a question, with the owner's ruling in section 2 |
| K | a correction, checked against code, records or a primary page |
| C | conflict between the vision and what is decided |
| DF | a finding about how the design reaches a builder today |
| DC | a part of the design contract |
| ST | a surface a stage can show |
| NF | a finding of the second round, section 13 |
| G | gap: something the vision leaves out |
| P | planned step |

## 1. The idea

The owner has spent weeks drawing the panel. The drawings must reach the workers, the result must be comparable with the drawing, and a screen that was accepted must never get worse. A screenshot with an index does the first part only. This round settles the last open questions about the drawings and describes the rest as a contract.

## 2. Rulings

All made on 2026-11-24. "As recommended" unless the row says otherwise. A ruling here sets direction. It authorizes no build, ticket or amendment.

| Code | Question | Ruling |
| --- | --- | --- |
| Q74 | The mark's states | Closed by the owner's own states of 2026-11-24. |
| Q75 | Does the mark change with the palette? | It takes each palette's ink. This replaces the recommendation, which kept Forest's greens everywhere. |
| Q76 | The orange orb of 16a | Replaced by the pendulum with a ring that follows the voice. |
| Q77 | Does the phone sign? | D31 is the target. Signing is marked as waiting for U1 and Q44. |
| Q78 | How does a lease show? | The owner's own answer: the last circle is orange while a lease is live, so a swinging mark with an orange circle is working under a lease. |
| Q79 | Orange on "needs you" | Kept, as an open ring, so it is never confused with a lease. A dot inside the ring is a lease that is still live. |
| Q80 | What shows away from a thread? | The first that is true, counting only items the owner has not set aside. Done clears when the thread is opened. |
| Q81 | What does each run state show? | The table in frame 65b. Passing every gate is not done. |
| Q82 | A late freeze | Capped at 2 seconds. |
| Q83 | Where do the strip and mark appear? | Every screen is brought up to date, not only the ten that lacked the mark. The strip is one component. |
| Q84 | Frames that contradict rulings | Corrected in one pass. |
| Q85 | Frames 61 and 63 | Redrawn from real records. |
| Q86 | Names | The inbox is Waiting on you. The state is Needs you. |
| Q87 | Flows FL12 to FL17 | Accepted. FL18 and FL19 were accepted with Q95. |
| Q88 | Frames taller than the host accepts | Split or trimmed, so no board passes 2,000 px. Captures are one whole image and 1:1 pieces. |
| Q89 | Motion in a still picture | Fixed poses for captures. The component and its numbers carry the motion. |
| Q90 | Which workstream owns each frame? | Frame 88, and `workstreamFrames` in the index. |
| Q91 | Settle the canvas again | Settled at version 52. |
| Q92 | Routines at a clock time | Allowed under three rules: an open dashboard page keeps the clock, the owner's last press is under 12 hours old, and each firing is one task. W05 and W14 write them. This answers C22 and C24. |
| Q93 | What Stop does (G4) | W17 defines it: end the running phase, keep the worktree and the record. |
| Q94 | The sorted review findings | LC1 as a light ticket after T15, with LS1 and LS2. The rest go into W06, W07, W08 and W11. |
| Q46 | What the panel is not | It replaces neither Sessions, Backlog, Metrics nor the Sessions log, and stores nothing of its own. The owner leaves it open: when the new place shows everything an old tab shows and the old tab was not opened for 30 days, a card may ask to move it. |
| Q40 | One path first | T15, A12, W04, W08, W16. No new brainstorm rounds or frames until W08's first milestone lands. New ideas wait in intake. |
| Q44 | How a watch or phone signs | Stop and the inbox first. Signing after U1. |
| Q42, Q43 | Glasses | Wait for TC1, then "what waits on you now". |
| Q95 | Intake | One private folder that any agent may write (O1), with a hand-dropped package as backup (O4). A server of Marimba's own only after the always-on host. Frames 83 to 86. |
| Q96 | Team size and success | At most six members, the Lead included, three by default, with the size on the card before it spends. Success is land rate, owner minutes and window share against one agent. For a project it is G26. |
| Q97 | Fifteen recommendations of the 2026-11-23 record, section 10 | All as recommended. Section 9 lists them. |
| Q99 | More states | Paused and No signal are in. Listening is a layer. Checking is out. |
| Q100 | Personal notes and Q95's folder | They never enter it. They stay on the owner's phone or drive. |
| Q101 | The design contract | Adopted, DC1 to DC6. |
| Q102 | The design source in the public repository | Committed, at `specs/design/awsf-v3-plan/source/`. |
| Q103 | When is the proof built? | As W08's first milestone, before any screen. It needs an amendment (section 10). |
| Q104 | `gpt-6.1-sol` and images | One small demonstration run, by the owner. |
| Q105 | What is the builders' simulator? | The stage, owned by the host. |
| Q106 | Who uses it? | The builder may look inside its own phase, with a limit on looks. The host's own capture is the only evidence. |
| Q107 | How is it watched live? | Each look is a record. The run screen shows the newest look beside its frame, with the earlier ones as a filmstrip. |
| Q108 | In what order? | ST1 and ST2 with DC5. ST3 after the MacBook and W12. ST4 last, after a test. |
| Q109 | Where do Apple's simulators run? | On macOS, reached by a bridge that carries only the three verbs, from wherever the factory lives (K30). |
| Q110 | Use "Install as app" now? | The owner's own answer: wait until it leaves beta, or until the owner says so. |
| Q111 | Does it replace W15's Mac app? | No. W15's deep plan compares three builds: native, the dashboard installed from the browser, and an installed artifact. |
| Q112 | When does a tecla ask permission again? | A recipe asks when its declared access changes. A program asks after any change to its bytes, the owner's own edits included. It sharpens NR4 and goes into AM6. |
| Q113 | Must a bug fix prove the bug first? | Yes. The ticket carries a check that the host runs on the base, where it must fail, and on the candidate, where it must pass. A light ticket after DC4. |
| Q114 | Does W08 limit the size of a turn? | Yes, 16,000 prompt tokens from its first version. The owner will raise or lower it from experience, so it is a setting with a record of each change. W09's median target under 10k stays. |
| Q115 | W10's base models | 9B first stays. The challenger becomes Qwen3.6-35B-A3B, and Gemma 4 26B-A4B joins the untuned baselines. It changes the spine's Q6, so it is applied when W10's deep plan is authored. |
| Q116 | What does a word search return? | The section under a heading. No trained retriever. It refines D18. Smart Health decides for itself. |

Q98 was folded into Q96.

### How earlier decisions read now

| Decision | Reads now |
| --- | --- |
| Q66 | The access line stays. The shape shows activity, and the last circle shows the lease. "One colour" governs lanes and access. The mark takes each palette's ink. |
| D15, Q67 | Unchanged, with Q92's three rules. "Open" means a page in front of the owner, because D31's host is always on. |
| D16 (I3) | Unchanged. The inbox keeps its name. |
| D30 | Unchanged. Q100 says what it means for intake. |
| U2 | Done at version 52. |
| P13 | Done. The frames are 61 to 63. |

## 3. Corrections

| Code | Earlier claim | What is true | Checked against |
| --- | --- | --- | --- |
| K27 | W07's evidence says the browser's remote-debugging protocol does not work from WSL. | It does for a Linux headless browser inside WSL. Inside the worker sandbox's own flags, with the network cut, Node's built-ins alone opened a page, clicked a button, read computed styles and 398 accessibility nodes, and took a screenshot in 969 ms. The browser was up in 248 ms. | a probe on 2026-11-24, chrome-headless-shell 1243, Node 22.23.1, `bwrap --unshare-all` with a read-only root |
| K28 | Nine frames were too tall and needed splitting. | Five of them were mostly empty space. Three other boards (46, 47, 59) had content cut off at the bottom. | the boards at canvas version 47 |
| K29 | The team-size and success evidence of the videos. | The raw transcripts could not be read on 2026-11-24 (HTTP 403). The package's summary and frames give no upper limit. Keys 1 to 6 open a member. One frame compares an agent alone (60 minutes) with five (15 minutes, 75 agent-minutes). No success measure for a running factory is shown. | the package of 2026-11-18 and 2026-11-23 |
| K30 | Q109's recommendation assumed a Linux VM on the Mac. | D31 and D34 put the factory on an always-on Linux box first. The VM is the fallback. The bridge is needed either way. | the 2026-11-09 record, D31 and D34 |
| K31 | The package's speed for a 35B-A3B model on the planned Mac is about 25.6 tokens per second. | That figure is from an M4 Pro. A community test of Qwen3.5-35B-A3B at 4 bits on an M5 Pro with 20 GPU cores and 64 GB gives 103 at 1k of context, 83 at 16k, 44 at 64k and 28 at 128k. Reading the prompt runs at 2,149 tokens per second at 16k and 806 at 128k. | https://omlx.ai/benchmarks/pg5gqj14, read 2026-11-24 |
| K32 | TensorFold serves the candidates for the local driver. | Its list calls Gemma 4 26B-A4B "Python-only", does not qualify a 35B-A3B on Metal, and its release notes say LoRA overlays are not yet wired to a flag. Nemotron 3.5 Lightning 30B-A3B is qualified. | its supported-models page and the v1.3.4 release, read 2026-11-24 |
| K33 | The base models of the local driver are open. | Q6 of the spine was ruled on 2026-10-02. | `specs/awsf-v3-plan.html`, Q6 |

## 4. The pendulum

One component, frame 64. Frames 65 to 65c, 79, 81 and 82 hold its rules and numbers, and `frame-facts.json` holds them as checkable lines.

| State | Shape | Read from |
| --- | --- | --- |
| Idle | hangs plumb, dimmed, still | nothing live, open or unseen |
| Working | swings, with a short trail | a live process or turn |
| Needs you | frozen bent, never straight, the last circle an open orange ring | an act only the owner may take and has not set aside |
| Paused | hangs, a ring around the last circle fills | a quota window or provider limit |
| Done | three overlapping green circles | landed, published or answered, until seen |
| No signal | outlines, dotted arms, no motion | the host does not answer, or a live record is older than 30 seconds |

Listening is a ring of ticks around any state. The last circle is filled orange only while a lease is live. In 4,000 simulated stops the freeze took 0.22 s at the median, 1.23 s at the 95th percentile and 2.02 s at most, and none was straight.

## 5. The frozen frames

The tracked files are `specs/design/awsf-v3-plan/frame-index.json`, `frame-digests.json`, `frame-facts.json` and `source/`. The index pins canvas version 52: 100 boards and 175 pieces, 275 images, each at most 2,000 px and 4 MiB. Two full captures gave identical files. The images stay in the ignored `docs/design/marimba-panel/2026-11-24/frames/`.

Every id of the previous freeze is kept, and so are W02's `ticketFrames`. 35 boards are new. `frame-facts.json` holds 363 facts for 100 boards and 46 shared facts in eight groups.

W08 owns 47 frames, which is too many for one plan, so it is cut into slices that each end in a screen the owner can open. The first slice is the strip, the pendulum and the access line on the dashboard that exists today: frames 17, 62, 64, 65, 79 and 80.

## 6. The design contract

### What holds today

| Code | Finding | Where |
| --- | --- | --- |
| DF1 | Images reach a worker only if the owner passes a binding to `awsf start --visual-references`. A run without it builds with no design and nothing complains. | `core/src/cli/commands/start.ts` |
| DF2 | The inspection gate has no result in the projected runs. It was demonstrated on 2026-09-23 and has not run since. | `gate_results`, read 2026-11-24 |
| DF3 | That gate proves the bytes reached the model, "never the quality of the visual judgment made from them". | `core/src/gates/visual-inspection.ts` |
| DF4 | `gpt-6.1-sol`, which built the last shifts, is not on the list of demonstrated routes, so a visual phase on it is refused. | `core/src/workflow/visual-references.ts`, `VISUAL_ROUTES` |
| DF5 | Until this freeze a worker saw pictures and no source, because `docs/design/` is ignored and a worktree holds only tracked files. | `.gitignore` |
| DF6 | Nothing captures the built screen. That is W07, which waits on W05. W08 does not wait on W07. | the spine |

### The contract

| Code | Part | What it does | State |
| --- | --- | --- | --- |
| DC1 | Images | What it looks like, sealed by digest. | frozen |
| DC2 | Source | Exact colours, sizes and words, and the code of the two shared components, in the worker's own tree. | frozen |
| DC3 | Facts | Checkable lines with ids, for every board. | written, not yet proven against a build |
| DC4 | Coverage | A fence refuses a frame that no ticket owns or excuses, and a UI ticket with no frames or facts. | draft in section 10 |
| DC5 | Proof | The host builds the screen with the same sample data, captures it at the frame's size, checks the drawn and style facts, and shows it beside the frame. | Q103 |
| DC6 | Ratchet | The owner presses Same, Better with a reason, or Not yet. Same and Better make that capture the new bar. Later changes to that screen stop until it is accepted again. | with DC5 |

A machine can prove unchanged and can check facts. Only the owner can judge better.

### How a plan and a ticket use it

1. A deep plan takes its frames from `workstreamFrames` and cuts them into slices that each end in a screen the owner can open.
2. A UI ticket names its frames, the fact ids it must satisfy and the sample data, in a DESIGN INPUTS block.
3. The run is started with a binding for its frames. The builder and the reviewer are both bound phases.
4. The reviewer answers pass or fail for each cited fact.
5. At the owner's journey the design, the built screen and the facts are side by side, and the owner presses.

## 7. A stage for builders

The owner asked on 2026-11-24 whether builders can have a simulator for the web, the phone and the watch, go back and forth until the result meets the design, be watched while they do it, and end with a comparison. Ruled on 2026-11-24 as recommended, with Q109 corrected (K30). The rulings are in section 2.

**What the vendors offer does not reach factory workers.** Claude Code's computer use needs an interactive session and is not available with `-p`. Its simulator pane runs in the desktop app's local sessions on macOS. Codex's computer use is in its desktop app. The factory's workers run `--print` and `-p`. The owner can use these in direct sessions on a Mac.

**A stage is simpler.** One host-owned command with three verbs: open a screen with a fixture, act on it, look at it. A look is a picture, the accessibility tree and the computed styles. Each surface has its own backend.

| Code | Surface | Backend | Today |
| --- | --- | --- | --- |
| ST1 | Dashboard and any web page | Linux headless browser in the worker's sandbox | works (K27) |
| ST2 | Phone-sized web page | the same, at 430 px | works (K27) |
| ST3 | iPhone app | iOS Simulator | needs macOS and Xcode |
| ST4 | Watch app | watchOS Simulator | needs macOS and Xcode, automation not confirmed |
| ST5 | Mac app | the screen of macOS | needs macOS |

| Code | Question | Recommendation | Alternative |
| --- | --- | --- | --- |
| Q105 | What is the simulator? | The stage, owned by the host. | vendor computer use in direct sessions only |
| Q106 | Who uses it? | The builder may look inside its own phase, with a limit on looks. The host's own capture is the only evidence. | host only, with correction rounds |
| Q107 | How is it watched live? | Each look is a record. The run screen shows the newest look beside its frame, with the earlier ones as a filmstrip. | live video, or the preview in a frame |
| Q108 | In what order? | ST1 and ST2 with DC5. ST3 after the MacBook and W12. ST4 last, after a test. | all at once |
| Q109 | Where do Apple's simulators run? | On macOS, reached from the factory's host by a bridge that carries only the three verbs. | the worker on macOS, without its Linux sandbox |

C25. W12 puts the factory in a Linux VM on the Mac, D31 prefers an always-on Linux box, and Apple's simulators run only on macOS. Q109's bridge answers both cases.

**Cost, as an estimate.** ST1 and ST2 are small, because the probe already does the three verbs with Node alone and no dependency. The builder's limit and its records are small to medium. The live filmstrip is medium. ST3 with the bridge is large. ST4 is unknown.

## 8. Intake and voice

Q95's folder holds `INTAKE.md`, `sources/` and `questions.md`. It is read when the dashboard opens, as data. Nothing in it can start a run. Word goes back the same way, as a status file with nothing personal in it.

The owner's idea of 2026-11-24 for voice: Whisper, OpenAI's open model, on the MacBook for every voice note and dictation, with a matching engine on the phone. It waits in intake (Q40). It fits W15, which already keeps speech on the Mac. Three things to carry: it should run on macOS beside the VM, it invents text in silence so silence is cut first and the words are shown before anything happens, and Spanish is tested on the owner's own notes. Its licence was not confirmed here.

## 9. The fifteen of Q97

| Topic | Ruled |
| --- | --- |
| Gate | Only the host's. |
| Templates | Build nothing while the copies match. |
| F46 to F51 | All except agents that hire agents. |
| Skill candidates | Checks first. |
| Bitter-lesson tags | plan-sota only, tested by A12. |
| Grilling | Before the plan. |
| RLVR | Unproven, kept as an idea. |
| Code Mode | One test in a scratch repository, never while driving. |
| Plan as a variable | After PS3 and PS4. |
| Fork or room | The room for planning, `prove` for comparing. |
| EGM plan review | Waits on A12. |
| Distilled self-bot | No. |
| Distilling other people | Cited sources only. |
| Voice in | Dictation and a word list. |
| Mission note | 40 to 70 lines, drafted with the owner, committed by the owner. |

## 10. Drafts, not applied

### DC4, a light ticket

> **Title:** Design coverage fence
>
> **What:** a meta-test that keeps the design contract whole. It reads `specs/design/awsf-v3-plan/` and the ticket stores and writes nothing.
>
> **Done means:**
> 1. Every frame in the index has its source file, its facts and its digest, and no id repeats.
> 2. Every fact id is unique, and every group a frame names exists.
> 3. Every board of kind screen or component is claimed by at least one ticket, or listed as unclaimed with a reason. At the start every board is unclaimed because its deep plan is not authored, so the fence begins green.
> 4. A ticket whose scope writes `dashboard/src/**` carries a DESIGN INPUTS block, and every frame and fact id in it exists.
> 5. A planted violation of each rule turns the fence red.
>
> **Open in it:** `ticketFrames` is keyed by a bare ticket id, so two deep plans collide. Give each deep plan its own small index over the same images, as W18 had.
>
> **Not:** no change to the host's visual-reference code.

### AM7, for the spine

> **Evidence that the rule costs something:** DF6. Screens could be built before any visual check exists. W18's tickets carried frames and no capture of the result.
>
> **What will be true:** W08's first milestone is the design proof (DC5, DC6): a host-run capture of the built screen with fixture data at the frame's size, the drawn and style facts checked, the two images side by side at the journey, and the accepted capture kept as the bar. No later milestone of W08 starts before it lands. W07 reuses it for its acceptance checks and keeps its own scope and dependencies. W07's evidence about the remote-debugging protocol is replaced by K27.
>
> **What it costs:** one milestone before the first visible screen. No runtime dependency: the browser is an external executable the owner installs, as Q7 decided.
>
> **The alternative that leaves the rule alone:** W08 waits for W07, which waits for W05.

AM6 is still unwritten. GA takes one amendment at a time.

### One line for AM6 (Q112)

> A recipe asks the owner again when its declared access changes. A program asks again after any change to its bytes, including the owner's own edits.

### One line for W08's deep plan (Q114)

> A driver turn carries at most 16,000 prompt tokens. The limit is an owner setting, and a change to it records the old value, the new one and the reason. Every turn records its size, and a turn over the limit is refused before it is sent.

The refusal in the last clause is the author's proposal. The owner has not ruled on it separately.

## 11. Gaps and plan

| Code | Gap |
| --- | --- |
| G29 | `ticketFrames` collide across deep plans. |
| G30 | Facts of kind eye have no words yet. A person's judgment is recorded only by DC6's press. |
| G31 | The pictures' fonts come from the network at capture time. A capture on another machine needs them installed. |
| G32 | No surface shows a phone or watch app the factory built (ST3, ST4). |

| Code | Step | Waits on |
| --- | --- | --- |
| P14 | Record this round and freeze the frames. Done by this file's commit. | |
| P15 | T15. | the owner |
| P16 | A12, and one Smart Health ticket (P9). | P15 |
| P17 | DC4 as a light ticket. | P15 |
| P18 | AM6, then AM7. | the owner's commits through GA |
| P19 | Q104's demonstration run. | the owner |
| P20 | W04's deep plan, then W08's, with the first slice of section 5. | P16, P18 |
| P21 | Rulings on Q105 to Q109. Done on 2026-11-24, with Q110 to Q116. | |
| P22 | Q112's line goes into AM6. | P18 |
| P23 | Q113 as a light ticket. | P17 |
| P24 | Q114's line goes into W08's deep plan. | P20 |
| P25 | Q115 is applied when W10's deep plan is authored, as a change to Q6. | W10 |
| P26 | Q116 goes into W04 and W16. | P20 |

## 12. Not verified

- That a worker on a subscription route sees a 1,000 px piece better than a 2,000 px whole. The pieces are cheap, so both are kept.
- Whether the outside agents of frame 86 can write a folder.
- Whether a watchOS Simulator can be driven without a person.
- The size of the facts' effect on a build. No build has used them yet.
- The vendors' pages of sections 7 and 13 were read on 2026-11-24 and change often.
- Whether a design canvas can be installed as an app, and what an installed app sends to its vendor.
- The speeds of K31 on the owner's own machine. They are one person's published runs.
- How many owner confirmations exist to train on. The projection held 6 attributions and was last written on 2026-11-09.

## 13. The second round: Install as app and local AI

The owner brought a vendor announcement of 2026-11-24 and a package of four threads: Shirudo, STAIR, Gemini 4 Neon with TensorFold, and mixture-of-experts models. Its factory parts are read here. Q40 sends new ideas to intake, so only Q112 and Q114 touch work that comes next.

### Findings

| Code | Finding | Where |
| --- | --- | --- |
| NF1 | Install as app turns an artifact into a Mac or Windows app with its own icon and window, in beta. With permission it can have shortcuts, notifications and always-on-top windows. It must be online and signed in. | https://claude.com/resources/articles/install-as-app |
| NF2 | Its permission "only covers the current version of the app", so it asks again "after every update, even your own edits". NR4 did not say which change. | the same page, and section 6 of the 2026-11-09 record |
| NF3 | The size of a turn matters more than the choice of model. A Marimba turn carries 146,748 prompt tokens at the median and all recorded turns write 744 tokens on average. With K31's speeds that is about 3.5 minutes from scratch, about 37 seconds with a warm cache, and about 13 seconds at 10k tokens. These three are estimates. | the corpus report, 2026-11-24 |
| NF4 | 96.3% of the recorded prompt tokens were cache reads, and a turn adds 8,788 new ones on average. | the corpus index |
| NF5 | In Shirudo an operator approves each shield (OpenAI), and the demonstration was "fully automated" (Isovalent). The factory's rule is stricter. | the two announcements of 2026-11-23 |
| NF6 | STAIR's figures are correct as the package quotes them. "Per-document fine-tuning" is an inference, because the paper does not say it. | arXiv 2609.03874 |
| NF7 | No gate in `core/src/gates` runs a reproducing check on the base before a fix. | a search on 2026-11-24 |
| NF8 | 356 of 495 tracked Markdown documents under `specs/` and `docs/` have three or more headings. | a count on 2026-11-24 |

### The package's other questions

These were answered from decisions that already hold, and the owner kept the answers.

| Package question | Answer |
| --- | --- |
| A signed envelope or a temporary act class | No. One press per act holds (decisions 4 and 14, invariant 13). W17's passkey signs the exact command, and leases already carry limits and revocation. |
| A receipt for a landing that others can verify | No. W17's signature is the evidence, and invariant 10 keeps receipt files out of git. |
| Agents speak code | Yes for checks, no for owner acts. |
| Build an inference engine for the Mac | Not before a base model is chosen. |
| The first experiment on the Mac | Serve and measure the untuned models on the trap and intent suites, with an MLX-based stack as Q6 says. |
| Fine-tuning data | Decision 2 already says which data. Data is the likely limit, not the method. |
| Grades for the local driver | No. It drives and does not build (decision 13, gate GR). |

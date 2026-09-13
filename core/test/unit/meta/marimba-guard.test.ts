import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, chmodSync, constants, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relRepo } from "./_walk.ts";
import { drivingDir } from "./_driving.ts";

// ---------------------------------------------------------------------------
// The offline behaviour matrix for marimba's two installed scripts. It runs the
// COMMITTED bytes — there is no second, installed copy of either file — feeds
// the guard a payload on stdin, and asserts what came back. No provider call,
// no quota, no network.
//
// WHY A META-TEST MAY SPAWN A PROCESS. child-process-fence.test.ts scopes the
// `node:child_process` ban to `core/src`; junk-drawer.test.ts already spawns
// `git` from this directory for the same reason. The thing under test is a
// shell script, so running it is the only way to assert its behaviour.
//
// THE DENY PROTOCOL, WHICH IS THE HALF A NAIVE TEST FORGETS. The guard's own
// header states it: exit 2, the reason on stderr, and NOTHING on stdout. A hook
// that writes to stdout while denying feeds its own prose back into the
// harness's decision channel, so every deny row below asserts all three parts,
// not just the exit code.
//
// THE ALLOWS ARE ASSERTED AS HARD AS THE DENIES. A guard that denied everything
// would pass a deny-only suite and be useless, and it would take `awsf status`,
// `awsf run` and `awsf retry` with it — the spend a phase's tier has already
// authorised. Those three are rows here for exactly that reason.
//
// THE ROWS THAT LOOK LIKE FAILURES AND ARE NOT. Three expectations below read
// backwards until you read the `why` beside them: malformed JSON and an empty
// payload ALLOW, and an owner act reached through a shell variable ALLOWS. The
// first two are the guard's deliberate fail-open on a payload it cannot parse;
// the third is the design's ceiling. They are pinned as expected behaviour so
// that changing any of them is a decision someone has to make on purpose.
//
// HOW THIS FILE WAS WRITTEN, since it collides with its own subject: the
// fixture text contains the seven owner-act phrases, and a driving session's
// guard denies any Bash command whose text contains one — including `echo` and
// `grep`. So this file was authored with the file-writing tools, whose payloads
// carry a `file_path` and no `command`. Running it is fine: the command line is
// a test-runner invocation and contains none of the phrases.
//
// IT SKIPS NOTHING. If either script is absent or not executable the first test
// below fails loudly. A skip is how a fence quietly stops meaning anything.
// ---------------------------------------------------------------------------

const MARIMBA_DIR = join(drivingDir(), "marimba");
const GUARD = join(MARIMBA_DIR, "delegation-guard.sh");
const BANNER = join(MARIMBA_DIR, "session-banner.sh");

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Never rejects. Every row is run before the tests are registered, so a spawn
 * failure has to arrive as a result an assertion can report rather than as an
 * unhandled rejection that takes the whole file down with an ENOENT.
 */
function run(script: string, payload: string, env?: Readonly<Record<string, string>>): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (result: RunResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const child = spawn(script, [], { env: { ...process.env, ...env } });
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (err: Error) => done({ code: -1, stdout, stderr: `could not spawn: ${err.message}` }));
    child.on("close", (code: number | null) => done({ code: code ?? -1, stdout, stderr }));
    child.stdin?.end(payload);
  });
}

const bash = (command: string): string => JSON.stringify({ tool_name: "Bash", tool_input: { command } });
const tool = (name: string, input: Record<string, string> = {}): string =>
  JSON.stringify({ tool_name: name, tool_input: input });

interface GuardRow {
  /** Row id, used as the test name. */
  readonly id: string;
  /** One line: why this row is in the table. Every row has one. */
  readonly why: string;
  readonly payload: string;
  readonly expect: "allow" | "deny";
  /**
   * Deny rows only: what the reason on stderr has to NAME — the act, or the
   * tool, or the machine condition. Deliberately not the wording around it.
   * Pinning prose makes the test fail on an improvement to the message.
   */
  readonly mentions?: readonly RegExp[];
  /** The unrunnable-parser row is the only one that needs a doctored PATH. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * A stub `python3` that exits 127, first on PATH. This reproduces the machine
 * defect the guard's Q2 branch exists for: an interpreter that cannot run, as
 * opposed to a payload it cannot parse. The two get opposite answers.
 */
const STUB_BIN = mkdtempSync(join(tmpdir(), "marimba-broken-parser-"));
writeFileSync(join(STUB_BIN, "python3"), "#!/bin/sh\nexit 127\n");
chmodSync(join(STUB_BIN, "python3"), 0o755);
after(() => rmSync(STUB_BIN, { recursive: true, force: true }));

/** The owner acts that construct a terminal, in the guard's own order. */
const OWNER_ACTS = ["land", "cancel", "rework", "review", "journey", "raise", "publish", "resume"] as const;

const GUARD_ROWS: readonly GuardRow[] = [
  // --- fence 2: owner acts in Bash command text ---------------------------
  {
    id: "bash · a command with no act in it",
    why: "the control for the whole fence: it is a targeted refusal, not a blanket one",
    payload: bash("echo hello"),
    expect: "allow",
  },
  {
    id: "bash · awsf status",
    why: "read-only diagnosis. Denying it would cost the session its own eyes",
    payload: bash("awsf status"),
    expect: "allow",
  },
  {
    id: "bash · awsf run",
    why: "the spend the phase's tier has already authorised; the guard is not a budget",
    payload: bash("awsf run T01"),
    expect: "allow",
  },
  {
    id: "bash · awsf retry",
    why: "retry builds no owner terminal, so it is not an owner act and the guard correctly omits it",
    payload: bash("awsf retry T01"),
    expect: "allow",
  },
  ...OWNER_ACTS.map(
    (act): GuardRow => ({
      id: `bash · awsf ${act}`,
      why: "an act reserved for the owner; each has a row so none can be dropped from the guard unnoticed",
      payload: bash(`awsf ${act} T01`),
      expect: "deny",
      mentions: [new RegExp(`\\b${act}\\b`)],
    }),
  ),
  {
    id: "bash · an act reached through a wrapper",
    why: "the fence reads the whole command text, so a task runner in front of the act does not hide it",
    payload: bash("just awsf rework T01"),
    expect: "deny",
    mentions: [/\brework\b/],
  },
  {
    id: "bash · an act with padded whitespace",
    why: "the payload is whitespace-normalised before matching, so spacing is not an evasion",
    payload: bash("awsf   land   T01"),
    expect: "deny",
    mentions: [/\bland\b/],
  },
  {
    id: "bash · an act under an allocated PTY",
    why: "the direct form of the bypass the fence exists for — `script -qec` clears the terminal-shape check, and this is what stops it",
    payload: bash('script -qec "awsf land T01"'),
    expect: "deny",
    mentions: [/\bland\b/],
  },
  {
    id: "bash · an act named through a shell variable",
    why: "THE KNOWN EVASION, pinned as an allow. The fence reads written text, not resolved intent, and this is the design's ceiling rather than a bug to fix. No arrangement of substring matching closes it, and widening the match until it might would cost more in false denials than the gap costs. If this row ever turns red, someone widened the match: read that decision, do not delete this row",
    payload: bash('v=land; script -qec "awsf $v T01"'),
    expect: "allow",
  },
  {
    id: "bash · a command that only reads an act name",
    why: "THE ACCEPTED OVER-DENIAL, pinned so it stays a known cost. Separating a mention from an invocation means parsing shell, and a guard that parses shell stops being reviewable",
    payload: bash('grep -rn "awsf land" docs/'),
    expect: "deny",
    mentions: [/\bland\b/],
  },
  {
    id: "bash · a command that only writes an act name",
    why: "the other half of the same over-denial: this is why this test file could not be authored with a shell heredoc",
    payload: bash("echo awsf land > f.txt"),
    expect: "deny",
    mentions: [/\bland\b/],
  },

  // --- fence 1: delegation-shaped tool names ------------------------------
  ...["Task", "Agent", "SendMessage", "Monitor", "ScheduleWakeup", "EnterWorktree"].map(
    (name): GuardRow => ({
      id: `tool · ${name}`,
      why: "classification is by SHAPE, not against a fixed list, so work started this way — with no attempt directory, no journal record, no reserved call and no gate — is denied even for a tool name that did not exist when the guard was written",
      payload: tool(name),
      expect: "deny",
      mentions: [new RegExp(`\\b${name}\\b`)],
    }),
  ),
  {
    id: "tool · a name whose stem is hidden by punctuation and case",
    why: "the name is lowercased and stripped to letters and digits before matching, so a separator does not hide the stem",
    payload: tool("Workflow_Dispatch"),
    expect: "deny",
    mentions: [/Workflow_Dispatch/],
  },
  ...["TaskOutput", "TaskStop", "TaskGet", "TaskList", "ListAgents", "CronList", "TaskCreate", "TaskUpdate"].map(
    (name): GuardRow => ({
      id: `tool · ${name}`,
      why: "a whole-name exclusion. These observe, enumerate or stop; denying them could strand work already running with no way to inspect or end it, and the plan-only ones create nothing at all",
      payload: tool(name),
      expect: "allow",
    }),
  ),
  ...["BashOutput", "KillShell"].map(
    (name): GuardRow => ({
      id: `tool · ${name}`,
      why: "on the exclusion list and also stem-free, so it passes twice over. Here so that trimming the list is a visible change rather than a silent one",
      payload: tool(name),
      expect: "allow",
    }),
  ),
  {
    id: "tool · mcp__srv__task",
    why: "an MCP server chooses its own nouns, so fence 1 does not read them at all — a stem inside a server's name is coincidence, not delegation",
    payload: tool("mcp__srv__task"),
    expect: "allow",
  },
  {
    id: "tool · a file write with no command",
    why: "fence 2 only ever looks at a `command` field, and a file-writing payload has none",
    payload: tool("Write", { file_path: "/tmp/x.ts", content: "x" }),
    expect: "allow",
  },
  {
    id: "tool · an edit whose target is the guard itself",
    why: "THE GUARD DOES NOT PROTECT ITS OWN FILES, pinned as expected. A third fence over the file-writing tools was considered and refused: it would leave the `sed -i` route open while reading as though it had closed both",
    payload: tool("Edit", { file_path: GUARD, old_string: "a", new_string: "b" }),
    expect: "allow",
  },

  // --- the two parser failures, which get opposite answers ----------------
  {
    id: "payload · malformed JSON",
    why: "FAILS OPEN, deliberately. A payload the parser rejects is what a harness schema change looks like, and failing closed there would brick every tool call on the day the schema moves",
    payload: "{not json",
    expect: "allow",
  },
  {
    id: "payload · empty",
    why: "the other shape of the same fail-open, and the one a misconfigured hook invocation actually produces",
    payload: "",
    expect: "allow",
  },
  {
    id: "machine · the payload parser cannot run",
    why: "FAILS CLOSED, and this row is the split. An interpreter that cannot run is a machine defect affecting every call; before the guard's Q2 branch it disabled BOTH fences and exited 0 with no signal at all. The reason has to carry its own cause and its own fix, because whoever reads it is looking at a broken machine",
    payload: bash("echo hello"),
    expect: "deny",
    mentions: [/python3/i, /\bfix\b/i],
    env: { PATH: `${STUB_BIN}:${process.env["PATH"] ?? ""}` },
  },
];

// ---------------------------------------------------------------------------
// The banner. Its third rule is the one worth a test: a banner that overclaims
// is worse than no banner, because it answers the question the owner actually
// has with something it does not know.
// ---------------------------------------------------------------------------

/** A path that cannot exist, so the absence branch runs without moving a file. */
const NO_SUCH_GUARD = join(STUB_BIN, "no-such-directory", "delegation-guard.sh");

/**
 * The nouns a claim about the hook has to reach for. Anchoring on these keeps
 * the matcher about THIS claim rather than about the words "active" or "fires"
 * in general — the banner talks about the guard SCRIPT and the parser in the
 * same breath, and both of those it genuinely checked.
 */
const HOOK_NOUN = /\b(?:PreToolUse|hooks?)\b/i;

/** The claim itself: the hook doing something, in the future or the present. */
const HOOK_ACTIVE =
  /\b(?:will\s+(?:fire|run|deny|be\s+denied)|fires|firing|is\s+(?:active|enabled|live|in\s+effect|registered\s+and\s+\w+)|is\s+enforcing|is\s+guarding)\b/i;

/**
 * THE RESIDUAL, named rather than closed: a line that overclaims and happens to
 * contain a negation somewhere else in it is missed. Requiring the negation to
 * sit next to the verb would need sentence parsing over hand-wrapped output.
 * The line the banner really prints — "NOT CHECKED: whether the PreToolUse hook
 * actually fires on the next tool call" — is the exact sentence that has to keep
 * passing, and it is a control below.
 */
const NEGATION = /\b(?:not|never|cannot|can't|unable|no)\b/i;

function hookClaims(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => HOOK_NOUN.test(line) && HOOK_ACTIVE.test(line) && !NEGATION.test(line))
    .map((line) => line.trim());
}

/** The banner reporting that it could not find what it was pointed at. */
const REPORTS_ABSENCE = /\b(?:MISSING|NOT EXEC)\b|\bno guard script\b/i;

// ---------------------------------------------------------------------------
// Everything runs first, concurrently, so that ~40 spawns cost one spawn's
// wall-clock rather than forty. The tests below only assert.
// ---------------------------------------------------------------------------

const guardResults = new Map<string, RunResult>(
  await Promise.all(
    GUARD_ROWS.map(async (row): Promise<[string, RunResult]> => [
      row.id,
      await run(GUARD, row.payload, row.env),
    ]),
  ),
);

const [bannerWithGuard, bannerWithoutGuard] = await Promise.all([
  run(BANNER, ""),
  run(BANNER, "", { MARIMBA_GUARD_PATH: NO_SUCH_GUARD }),
]);

test("both committed scripts are present and executable", () => {
  for (const script of [GUARD, BANNER]) {
    assert.doesNotThrow(
      () => accessSync(script, constants.X_OK),
      `${relRepo(script)} is missing or not executable. This suite fails rather than skips: ` +
        "a skip is how a fence stops meaning anything without anyone noticing. " +
        "The repository holds the only copy of both scripts.",
    );
  }
});

test("every row in the table carries a reason it is there", () => {
  const missing = GUARD_ROWS.filter((row) => row.why.trim().length === 0).map((row) => row.id);
  assert.deepEqual(missing, [], "a row with no reason is a row nobody can safely delete or change");
  assert.equal(new Set(GUARD_ROWS.map((row) => row.id)).size, GUARD_ROWS.length, "row ids must be unique");
  const denyWithoutMentions = GUARD_ROWS.filter(
    (row) => row.expect === "deny" && (row.mentions ?? []).length === 0,
  ).map((row) => row.id);
  assert.deepEqual(denyWithoutMentions, [], "every deny row must say what its reason has to name");
});

test("the table asserts allows as hard as denies", () => {
  // A guard that denied everything would pass a deny-only suite. This is the
  // arithmetic that stops the table drifting into one.
  const allows = GUARD_ROWS.filter((row) => row.expect === "allow").length;
  assert.ok(allows >= 15, `only ${allows} allow rows; the deny-only failure mode is what this table exists to avoid`);
});

for (const row of GUARD_ROWS) {
  test(`guard ${row.expect === "deny" ? "denies" : "allows"}: ${row.id}`, () => {
    const result = guardResults.get(row.id);
    assert.ok(result, `no result captured for ${row.id}`);
    const seen = `exit ${result.code}, stdout ${JSON.stringify(result.stdout)}, stderr ${JSON.stringify(result.stderr)}`;

    if (row.expect === "allow") {
      assert.equal(result.code, 0, `${row.why} — ${seen}`);
      assert.equal(result.stdout, "", `an allowed call must produce no output at all — ${seen}`);
      assert.equal(result.stderr, "", `an allowed call must produce no output at all — ${seen}`);
      return;
    }

    // The deny protocol, all three parts.
    assert.equal(result.code, 2, `${row.why} — ${seen}`);
    assert.equal(result.stdout, "", `the deny protocol puts NOTHING on stdout — ${seen}`);
    assert.ok(result.stderr.trim().length > 0, `a deny with no reason on stderr tells the session nothing — ${seen}`);
    for (const mention of row.mentions ?? []) {
      assert.match(result.stderr, mention, `the reason must name what it refused — ${seen}`);
    }
  });
}

test("banner: exits 0 and confirms the guard when the guard is there", () => {
  assert.equal(bannerWithGuard.code, 0, "a SessionStart hook that fails is a new way to break a session for nothing");
  assert.ok(bannerWithGuard.stdout.includes(GUARD), "it must name the path it actually checked");
  assert.deepEqual(hookClaims(bannerWithGuard.stdout), [], "see the hook-claim test below");
});

test("banner: exits 0 AND reports the absence when the guard path resolves to nothing", () => {
  assert.equal(bannerWithoutGuard.code, 0, "the absence is the case the banner exists for; it may not become an exit code");
  assert.ok(
    bannerWithoutGuard.stdout.includes(NO_SUCH_GUARD),
    "it must name the path that did not resolve — a moved checkout is how this happens, and the path is the whole diagnosis",
  );
  assert.match(
    bannerWithoutGuard.stdout,
    REPORTS_ABSENCE,
    "a banner that prints a missing guard as though it were present is the failure this file exists to catch",
  );
});

test("banner: no line it prints claims the PreToolUse hook will fire", () => {
  // The one that matters. A hook registration that loads is not a hook that
  // fires, and the banner cannot tell the difference — so it may report the
  // three things it did check, and may not imply the fourth.
  for (const [label, result] of [
    ["guard present", bannerWithGuard],
    ["guard absent", bannerWithoutGuard],
  ] as const) {
    assert.deepEqual(
      hookClaims(result.stdout),
      [],
      `${label}: the banner claimed the hook is active or will fire. It cannot know that`,
    );
  }
});

test("the hook-claim matcher bites, and passes the sentences the banner really prints", () => {
  const overclaims = [
    "  ok        the PreToolUse hook will fire on the next tool call",
    "  ok        the guard hook is active for this session",
    "  ok        every delegation-shaped tool call will be denied by the hook",
    "  ok        hook registered and firing",
  ];
  for (const line of overclaims) {
    assert.deepEqual(hookClaims(line), [line.trim()], `the matcher missed an overclaim: ${line}`);
  }

  // The over-fire control: the banner's real lines, which say the true thing
  // using the same nouns. A matcher that fails here would push the next author
  // into deleting the honest sentence instead of the dishonest one.
  const innocents = [
    "NOT CHECKED: whether the PreToolUse hook actually fires on the next tool call.",
    "This banner cannot determine that and does not claim it. 3 confirmed, 0 to fix.",
    "            Check the PreToolUse hook command in marimba/settings.json - the",
    "  ok        guard script present and executable: /x/delegation-guard.sh",
    "  ok        payload parser runs (python3)",
  ];
  for (const line of innocents) {
    assert.deepEqual(hookClaims(line), [], `over-fire on a sentence the banner is right to print: ${line}`);
  }
});

test("the absence matcher bites, and does not fire on a confirmed guard", () => {
  assert.match("  MISSING   no guard script at /x/y.sh", REPORTS_ABSENCE);
  assert.match("  NOT EXEC  guard script present but not executable: /x/y.sh", REPORTS_ABSENCE);
  assert.doesNotMatch("  ok        guard script present and executable: /x/y.sh", REPORTS_ABSENCE);
});

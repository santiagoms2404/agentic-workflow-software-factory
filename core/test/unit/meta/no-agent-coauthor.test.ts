import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./_walk.ts";

// AGENTS.md invariant 11: no commit ever names an agent/model/AI tool as
// author, committer, co-author, or collaborator. A commit's own completion
// metadata belongs in the plan's <dl>/Amendments, never in the commit itself.
const AGENT_IDENTITY_PATTERNS = [
  /@anthropic\.com/i,
  /@openai\.com/i,
  /\b(claude|gpt|codex|copilot|gemini|chatgpt)\b/i,
];

function isAgentShaped(value: string): boolean {
  return AGENT_IDENTITY_PATTERNS.some((p) => p.test(value));
}

// The message half reads every line of every commit message, not only
// co-author trailers (B5-01): a session's completion metadata is just as
// forbidden as a co-author. Every refused key, phrase and URL below is built at
// run time so this source, and any commit message quoting it, never spells one
// (the fences scan sources and history alike).
const SESSION = "Sess" + "ion";
const CO_AUTHOR_KEY = new RegExp("^\\s*" + "Co-" + "Authored-By\\s*:", "i");
// Mail domains of AI tools' noreply identities, refused on a co-author line
// even when the display name looks human.
const AI_NOREPLY_ADDRESS = new RegExp(
  "@(" + ["anthropic", "openai", "cursor", "githubcopilot"].join("|") + ")\\.com\\b",
  "i",
);
// Any trailer-shaped `Key: value` line; the key decides what it names.
const TRAILER_LINE = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/;
const SESSION_KEY = new RegExp(SESSION, "i");
// A hyphenated key that starts with an agent name (`<Agent>-Model:`, ...).
// A bare `agent:model` selector in prose has no hyphen and is not a trailer.
const AGENT_NAMED_KEY = /^(claude|gpt|codex|copilot|gemini|chatgpt)(-[\w]+)+$/i;
const GENERATED_WITH = new RegExp("^\\W*" + "Generat" + "ed with\\b", "i");
const BUILT_ON = new RegExp("^\\s*" + "built " + "on\\s*:", "i");
const AGENT_SESSION_URL = new RegExp(
  [
    "claude\\.ai/(code|chat|share)\\b",
    "claude\\.com/claude-code\\b",
    "chatgpt\\.com/(codex|c|share)\\b",
    "chat\\.openai\\.com/",
    "gemini\\.google\\.com/(app|share)\\b",
    "cursor\\.com/agents\\b",
  ].join("|"),
  "i",
);

function isRefusedMessageLine(line: string): boolean {
  if (CO_AUTHOR_KEY.test(line)) return isAgentShaped(line) || AI_NOREPLY_ADDRESS.test(line);
  if (GENERATED_WITH.test(line) || BUILT_ON.test(line) || AGENT_SESSION_URL.test(line)) return true;
  const trailer = TRAILER_LINE.exec(line);
  if (!trailer) return false;
  const key = trailer[1] ?? "";
  const value = trailer[2] ?? "";
  if (AGENT_NAMED_KEY.test(key)) return true;
  return SESSION_KEY.test(key) && (isAgentShaped(key) || isAgentShaped(value));
}

// Owner amendment O1 under AGENTS.md invariant 11 (2026-10-16): this one
// commit carries an agent session trailer from before the fence read message
// lines beyond co-author trailers, and history is kept rather than rewritten.
// It is exempt by its FULL SHA only, so an abbreviated SHA or any other commit
// with the same trailer is still refused. Never add a second entry without a
// new owner amendment.
const PRE_FENCE_BREACHES: ReadonlySet<string> = new Set(["e04664e3c85c3fc5d6f43353102d2215b501a803"]);

interface CommitMessage {
  sha: string;
  body: string;
}

function messageOffenders(commits: CommitMessage[]): string[] {
  return commits
    .filter(({ sha }) => !PRE_FENCE_BREACHES.has(sha))
    .filter(({ body }) => body.split("\n").some(isRefusedMessageLine))
    .map(({ sha }) => sha);
}

test("no commit in history has an agent as author or committer", () => {
  const log = execFileSync("git", ["log", "--all", "--format=%H%x00%an <%ae>%x00%cn <%ce>%x03"], {
    cwd: repoRoot(),
  }).toString("utf8");
  const offenders = log
    .split("\x03")
    .filter(Boolean)
    .map((entry) => {
      const [sha, author, committer] = entry.split("\x00");
      return { sha, author: author ?? "", committer: committer ?? "" };
    })
    .filter(({ author, committer }) => isAgentShaped(author) || isAgentShaped(committer))
    .map(({ sha }) => sha);
  assert.deepEqual(offenders, []);
});

test("an agent session trailer line is refused", () => {
  const trailer = "Claude" + "-" + SESSION + ": abc123";
  assert.equal(isRefusedMessageLine(trailer), true);
});

test("a co-author trailer naming an AI is refused, a human one is not", () => {
  const key = "Co-" + "authored-by: ";
  assert.equal(isRefusedMessageLine(key + "Copilot <ada@example.org>"), true);
  assert.equal(isRefusedMessageLine(key + "Helper <noreply@" + "cursor" + ".com>"), true);
  assert.equal(isRefusedMessageLine(key + "Ada Lovelace <ada@example.org>"), false);
});

test("a generated-with line, a built-on line and an agent session URL are refused", () => {
  assert.equal(isRefusedMessageLine("\u{1F916} " + "Generat" + "ed with a tool"), true);
  assert.equal(isRefusedMessageLine("built " + "on: provider:model-x"), true);
  assert.equal(isRefusedMessageLine("see https://" + "claude" + ".ai/" + "code/" + "s_1 for the log"), true);
  assert.equal(isRefusedMessageLine("the fixture is generated by a script"), false);
  assert.equal(isRefusedMessageLine("claude:opus answered as two models."), false);
});

test("the O1 exemption matches only the full e04664e SHA", () => {
  const body = "feat: x\n\n" + "Claude" + "-" + SESSION + ": abc123\n";
  const exempt = "e04664e3c85c3fc5d6f43353102d2215b501a803";
  const other = "f".repeat(40);
  assert.deepEqual(
    messageOffenders([
      { sha: exempt, body },
      { sha: exempt.slice(0, 7), body },
      { sha: other, body },
    ]),
    [exempt.slice(0, 7), other],
  );
});

// Scope: every ref in this checkout's shared git common dir (`git log --all`),
// the same scope the author/committer check above has always used.
test("no commit in history carries an agent co-author, session trailer or tool line", () => {
  const log = execFileSync("git", ["log", "--all", "--format=%H%x00%B%x03"], {
    cwd: repoRoot(),
    maxBuffer: 1 << 28,
  }).toString("utf8");
  const commits = log
    .split("\x03")
    .filter(Boolean)
    .map((entry) => {
      const [sha, body] = entry.split("\x00");
      return { sha: (sha ?? "").trim(), body: body ?? "" };
    })
    .filter(({ sha }) => sha !== "");
  assert.deepEqual(messageOffenders(commits), []);
});

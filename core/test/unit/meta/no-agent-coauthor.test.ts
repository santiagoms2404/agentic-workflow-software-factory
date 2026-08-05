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

test("no commit in history names an agent as a co-author trailer", () => {
  const log = execFileSync("git", ["log", "--all", "--format=%H%x00%B%x03"], { cwd: repoRoot() }).toString("utf8");
  const offenders = log
    .split("\x03")
    .filter(Boolean)
    .map((entry) => {
      const [sha, body] = entry.split("\x00");
      return { sha, body: body ?? "" };
    })
    .filter(({ body }) =>
      body
        .split("\n")
        .some((line) => /^Co-Authored-By:/i.test(line) && isAgentShaped(line)),
    )
    .map(({ sha }) => sha);
  assert.deepEqual(offenders, []);
});

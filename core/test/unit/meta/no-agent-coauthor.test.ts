import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { repoRoot } from "./_walk.ts";

// AGENTS.md invariant 11: no commit ever names an agent/model/AI tool as a
// co-author. A commit's own completion metadata belongs in the plan's
// <dl>/Amendments, never in the commit trailer.
const AGENT_COAUTHOR_PATTERNS = [
  /Co-Authored-By:.*@anthropic\.com/i,
  /Co-Authored-By:.*@openai\.com/i,
  /Co-Authored-By:.*\b(claude|gpt|codex|copilot|gemini|chatgpt)\b/i,
];

test("no commit in history names an agent as a co-author", () => {
  const log = execFileSync("git", ["log", "--all", "--format=%H%x00%B%x03"], { cwd: repoRoot() }).toString("utf8");
  const offenders = log
    .split("\x03")
    .filter(Boolean)
    .map((entry) => {
      const [sha, body] = entry.split("\x00");
      return { sha, body };
    })
    .filter(({ body }) => AGENT_COAUTHOR_PATTERNS.some((p) => p.test(body ?? "")))
    .map(({ sha }) => sha);
  assert.deepEqual(offenders, []);
});

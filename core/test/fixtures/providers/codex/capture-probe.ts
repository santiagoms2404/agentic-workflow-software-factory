// The capture script for this directory's fixtures. Committed so the provenance
// note beside it is checkable rather than asserted: the argv the probe ran is
// the argv `PiCodexAdapter.buildSpec` produces, and this file is how anyone can
// see that for themselves without spending a second live call.
//
// It lives under `core/test/fixtures/` and not under `core/src/` for the same
// reason `stub-provider.mjs` and the Claude capture script do: it has to spawn,
// and `node:child_process` is importable nowhere in `core/src` except
// `execution/transport-broker.ts`. A capture script that needed an exemption
// from that fence would weaken the invariant it exists to help test.
//
//   node --experimental-strip-types core/test/fixtures/providers/codex/capture-probe.ts <out.jsonl>
//
// ONE bounded live call. Do not run it to "refresh" a fixture — the fixtures in
// this directory are replayed, never regenerated.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PiCodexAdapter } from "../../../../src/adapters/pi-codex.ts";

const PROBE_CWD = "/tmp/awsf-codex-probe";

const PROMPT =
  "Use the ls tool to list the files in the current directory, " +
  "then reply with only the number of files you found.";

const out = process.argv[2];
if (out === undefined) throw new Error("usage: capture-probe.ts <out.jsonl>");

const spec = new PiCodexAdapter().buildSpec({
  model: "codex:gpt-5.6-sol",
  prompt: PROMPT,
  cwd: PROBE_CWD,
  env: process.env as Record<string, string>,
  effort: "low",
  profile: "readonly",
});

console.error(`argv: ${JSON.stringify([spec.executable, ...spec.argv])}`);
console.error(`env:  ${JSON.stringify(spec.env)}`);

const child = spawn(spec.executable, [...spec.argv], {
  cwd: spec.cwd,
  env: { ...spec.env },
  stdio: ["pipe", "pipe", "pipe"],
  shell: spec.shell,
});

const stdout: Buffer[] = [];
const stderr: Buffer[] = [];
child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

child.stdin.write(spec.stdin);
child.stdin.end();

child.on("close", (code: number | null, signal: string | null) => {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.concat(stdout));
  writeFileSync(`${out}.stderr.txt`, Buffer.concat(stderr));
  console.error(`exit: code=${String(code)} signal=${String(signal)}`);
  console.error(`wrote ${String(Buffer.concat(stdout).length)} bytes to ${out}`);
});

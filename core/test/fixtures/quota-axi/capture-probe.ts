// The capture script for this directory's fixtures. Committed so the provenance
// note beside it is checkable rather than asserted: the argv the probe ran is
// the argv `buildQuotaAxiArgv` produces, and this file is how anyone can see
// that for themselves without spending a second live call.
//
// It lives under `core/test/fixtures/` and not under `core/src/` because it has
// to spawn. `node:child_process` remains importable nowhere in `core/src`
// except `execution/transport-broker.ts`.
//
//   node --experimental-strip-types core/test/fixtures/quota-axi/capture-probe.ts <out.json>
//
// ONE bounded live call. Do not run it to "refresh" a fixture. The fixture in
// this directory is replayed, never regenerated.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveExecutable } from "../../../src/execution/transport-broker.ts";
import {
  QUOTA_AXI_EXECUTABLE,
  buildQuotaAxiArgv,
} from "../../../src/quota/probe.ts";

const PROVIDERS = "claude,codex";
const TIMEOUT_MS = 30_000;

const out = process.argv[2];
if (out === undefined) throw new Error("usage: capture-probe.ts <out.json>");

const env = process.env as Record<string, string>;
const executable = resolveExecutable(QUOTA_AXI_EXECUTABLE, env);
const argv = buildQuotaAxiArgv(PROVIDERS);
const captureStartedAt = new Date().toISOString();

console.error(`capture-start: ${captureStartedAt}`);
console.error(`argv: ${JSON.stringify([executable, ...argv])}`);

const child = spawn(executable, [...argv], {
  cwd: process.cwd(),
  env: { ...env },
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});

const stdout: Buffer[] = [];
const stderr: Buffer[] = [];
child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

const timeout = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
timeout.unref();

child.on("close", (code: number | null, signal: string | null) => {
  clearTimeout(timeout);
  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, stdoutBytes);
  writeFileSync(`${out}.stderr.txt`, stderrBytes);
  console.error(`capture-end: ${new Date().toISOString()}`);
  console.error(`exit: code=${String(code)} signal=${String(signal)}`);
  console.error(`stdout-bytes: ${String(stdoutBytes.length)}`);
  console.error(`stderr-bytes: ${String(stderrBytes.length)}`);
});

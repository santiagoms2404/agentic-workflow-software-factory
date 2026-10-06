// The exit code a review or production process record carries for a
// `run.failed` terminal: what the process already reported, never a guess.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProcessExit, ProcessTransport } from "../../../src/adapters/interface.ts";
import { observedExitCode } from "../../../src/cli/commands/production-run.ts";

function fakeTransport(exit: Promise<ProcessExit>): ProcessTransport {
  return { exit } as unknown as ProcessTransport;
}

test("a reported exit code reaches the record", async () => {
  assert.equal(await observedExitCode(fakeTransport(Promise.resolve({ code: 3, signal: null }))), 3);
  assert.equal(await observedExitCode(fakeTransport(Promise.resolve({ code: 0, signal: null }))), 0);
});

test("an exit the process never reported stays null, and is not waited for", async () => {
  const started = Date.now();
  assert.equal(await observedExitCode(fakeTransport(new Promise(() => {}))), null);
  assert.ok(Date.now() - started < 1_000, "the adapter owns the bounded wait; the record does not add one");
});

test("a signal-only exit, a rejected exit, and no transport all stay null", async () => {
  assert.equal(await observedExitCode(fakeTransport(Promise.resolve({ code: null, signal: "SIGKILL" }))), null);
  assert.equal(await observedExitCode(fakeTransport(Promise.reject(new Error("lost")))), null);
  assert.equal(await observedExitCode(null), null);
  assert.equal(await observedExitCode(undefined), null);
});

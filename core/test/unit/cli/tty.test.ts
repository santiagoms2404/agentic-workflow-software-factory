import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readOwnerConfirmation } from "../../../src/cli/tty.ts";

/** Fails instead of hanging: an unsettled prompt is exactly the defect under test. */
function settledWithin<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`prompt did not settle within ${String(ms)} ms`)), ms);
  });
  return Promise.race([pending, expired]).finally(() => clearTimeout(timer));
}

function streams(): { input: PassThrough; output: PassThrough } {
  const output = new PassThrough();
  output.resume();
  return { input: new PassThrough(), output };
}

test("B7-34: end of input at the owner prompt settles as a refusal, not an unsettled promise", async () => {
  const { input, output } = streams();
  const pending = readOwnerConfirmation(input, output, "Continue this exact saved workflow?");
  input.end();
  assert.equal(await settledWithin(pending, 2000), false);
});

test("B7-34: an explicit yes is still a confirmation and anything else is a refusal", async () => {
  const yes = streams();
  const pendingYes = readOwnerConfirmation(yes.input, yes.output, "Proceed?");
  yes.input.write("yes\n");
  assert.equal(await settledWithin(pendingYes, 2000), true);

  const no = streams();
  const pendingNo = readOwnerConfirmation(no.input, no.output, "Proceed?");
  no.input.write("n\n");
  assert.equal(await settledWithin(pendingNo, 2000), false);
});

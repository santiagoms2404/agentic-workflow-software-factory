import assert from "node:assert/strict";
import { test } from "node:test";
import { memoizeUntilRejected } from "../../../dashboard/src/memo-loader.ts";

// B14-01, B13-07, B13-08: the settings loader memoized its first request,
// rejection included, so one failed GET /api/v1/settings made every later poll
// reject until the page was reloaded.
test("after a rejected first load, the next call retries and resolves", async () => {
  let calls = 0;
  const load = memoizeUntilRejected(async () => {
    calls += 1;
    if (calls === 1) throw new Error("Settings unavailable");
    return "settings";
  });
  await assert.rejects(load(), /Settings unavailable/);
  const second = await load().then((value) => value, (error: Error) => `rejected: ${error.message}`);
  assert.equal(second, "settings");
  assert.equal(calls, 2);
});

test("a resolved value stays memoized: the loader runs once across later calls", async () => {
  let calls = 0;
  const load = memoizeUntilRejected(async () => {
    calls += 1;
    return { read: calls };
  });
  const first = await load();
  const later = [await load(), await load()];
  assert.deepEqual(first, { read: 1 });
  assert.equal(later[0], first, "the same object, not a re-read");
  assert.equal(later[1], first);
  assert.equal(calls, 1);
});

test("concurrent callers share one in-flight request", async () => {
  let calls = 0;
  let finish!: (value: string) => void;
  const load = memoizeUntilRejected(() => {
    calls += 1;
    return new Promise<string>((resolve) => { finish = resolve; });
  });
  const a = load();
  const b = load();
  assert.equal(a, b, "both callers hold the one request");
  assert.equal(calls, 1);
  finish("groups");
  assert.deepEqual(await Promise.all([a, b]), ["groups", "groups"]);
  assert.equal(calls, 1);
});

test("callers that shared a rejected request all see it, and only the next call reads again", async () => {
  let calls = 0;
  let fail!: (error: Error) => void;
  const load = memoizeUntilRejected(() => {
    calls += 1;
    if (calls > 1) return Promise.resolve(`read ${calls}`);
    return new Promise<string>((_, reject) => { fail = reject; });
  });
  const a = load();
  const b = load();
  fail(new Error("Groups unavailable"));
  await assert.rejects(a, /Groups unavailable/);
  await assert.rejects(b, /Groups unavailable/);
  assert.equal(calls, 1, "a shared failure is one request, not one per caller");
  assert.equal(await load(), "read 2");
  assert.equal(await load(), "read 2", "the retried value is memoized in turn");
  assert.equal(calls, 2);
});

// The replacement review's retry, in the two pieces that can be tested without
// a provider: which failures spend the held call, and what the retry says.

import assert from "node:assert/strict";
import { test } from "node:test";

import { contractRetryPrompt, CONTRACT_RETRY_HEADING } from "../../../src/cli/commands/review.ts";
import { MandatoryReviewUnavailable, runMandatoryReview } from "../../../src/workflow/review-routing.ts";

const PAIR = ["openai-codex", "anthropic"] as const;

function options<T>(overrides: Partial<Parameters<typeof runMandatoryReview<T>>[0]>): Parameters<typeof runMandatoryReview<T>>[0] {
  return {
    workerProvider: "openai-codex",
    providers: PAIR,
    execute: () => Promise.reject(new Error("unconfigured")),
    isTransportFailure: () => false,
    ...overrides,
  } as Parameters<typeof runMandatoryReview<T>>[0];
}

test("without a contract predicate, a non-transport failure is still rethrown on the first attempt", async () => {
  const attempts: number[] = [];
  await assert.rejects(
    runMandatoryReview(options({
      execute: (_provider, attempt) => {
        attempts.push(attempt);
        return Promise.reject(new Error("malformed"));
      },
    })),
    /malformed/,
  );
  assert.deepEqual(attempts, [1], "the production runner's behaviour is unchanged: no second turn");
});

test("a contract failure spends the held retry once, and the second is rethrown as itself", async () => {
  const attempts: number[] = [];
  await assert.rejects(
    runMandatoryReview(options({
      execute: (_provider, attempt) => {
        attempts.push(attempt);
        return Promise.reject(new Error("did not validate"));
      },
      isContractFailure: () => true,
    })),
    (error: Error) => {
      // NOT MandatoryReviewUnavailable: the review was available and answered
      // twice. Calling it unavailable would misname the failure the owner reads.
      assert.equal(error instanceof MandatoryReviewUnavailable, false);
      assert.match(error.message, /did not validate/);
      return true;
    },
  );
  assert.deepEqual(attempts, [1, 2], "exactly one retry, never more");
});

test("a contract failure that succeeds on the retry returns the retry's answer", async () => {
  const result = await runMandatoryReview<string>(options<string>({
    execute: (_provider, attempt) => attempt === 1
      ? Promise.reject(new Error("did not validate"))
      : Promise.resolve("second"),
    isContractFailure: () => true,
  }));
  assert.equal(result, "second");
});

test("a transport failure still exhausts into MandatoryReviewUnavailable", async () => {
  await assert.rejects(
    runMandatoryReview(options({
      execute: () => Promise.reject(new Error("transport")),
      isTransportFailure: () => true,
      isContractFailure: () => true,
    })),
    MandatoryReviewUnavailable,
  );
});

test("transport is classified before contract, so a transport fault is never miscounted", async () => {
  const asked: string[] = [];
  await assert.rejects(
    runMandatoryReview(options({
      execute: () => Promise.reject(new Error("transport")),
      isTransportFailure: () => { asked.push("transport"); return true; },
      isContractFailure: () => { asked.push("contract"); return true; },
    })),
    MandatoryReviewUnavailable,
  );
  assert.deepEqual(asked, ["transport", "transport"], "the contract predicate is never consulted for a transport fault");
});

test("the contract correction carries the violations and nothing about the verdict", async () => {
  const base = "ORIGINAL PROMPT WITH THE COMPOSED EVIDENCE";
  const prompt = contractRetryPrompt(base, ["/findings/0/level: Unexpected property"]);
  assert.ok(prompt.startsWith(base), "the original prompt is a prefix, so evidence containment still holds");
  assert.match(prompt, new RegExp(CONTRACT_RETRY_HEADING));
  assert.match(prompt, /\/findings\/0\/level: Unexpected property/);
  assert.match(prompt, /unchanged in substance/, "the retry is told to keep its findings, not to revise them");
  // The owner's reason and the superseded verdict are the two things a reviewer
  // must never be briefed on; a correction about form may not smuggle either in.
  for (const forbidden of [/accept/i, /concern/i, /owner/i, /superseded/i, /reject/i]) {
    assert.doesNotMatch(prompt, forbidden);
  }
});

test("an unextractable envelope still produces a usable correction", async () => {
  const prompt = contractRetryPrompt("BASE", []);
  assert.match(prompt, /no envelope was extracted/);
});

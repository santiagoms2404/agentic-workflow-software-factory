// Offline tests for the single Jev transport (W19 task 1). Global fetch is
// stubbed in every test; no test reaches the network or reads a real key.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  ContractError,
  JEV_DEFAULT_MODEL,
  JEV_ENDPOINT,
  JEV_KEY_ENV,
  JEV_RATE,
  JevTransport,
  QuestionValidationError,
  jevCost,
  type JevOutcome,
  type JevQuestions,
} from "../../../src/decision/jev-transport.ts";
import { REDACTED_VALUE } from "../../../src/policy/redaction.ts";
import { loadCatalog, CatalogSchemaError } from "../../../src/registry/catalog.ts";
import { jevSwitchOf } from "../../../src/registry/catalog-schema.ts";

// Not a credential: a placeholder that only has to be present and nonblank.
const KEY = "test-placeholder-key";
const ENV = { [JEV_KEY_ENV]: KEY };

const QUESTIONS = {
  progressing: { type: "noul", instructions: "Is the shift making progress?" },
  next_act: {
    type: "choice",
    instructions: "Which act fits this stop?",
    criteria: { raise: "Raise the ceiling.", wait_for_owner: null, other: null },
  },
  risk: { type: "score", instructions: "How risky is acting now?", criteria: ["low", "medium", "high"] },
} as const satisfies JevQuestions;

/** The shape of the 2026-09-28 smoke answer, on synthetic questions. */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "typesafe/jev-1.13-20260917",
    answers: {
      progressing: { type: "noul", noul: 0.81 },
      next_act: {
        type: "choice",
        choice: "raise",
        probabilities: { raise: 0.75, wait_for_owner: 0.2, other: 0.05 },
        confidence: 0.68,
      },
      risk: {
        type: "score",
        score: 0.97,
        legend: { "0": "low", "1": "medium", "2": "high" },
        probabilities: { "0": 0.3, "1": 0.43, "2": 0.27 },
        confidence: 0.4,
      },
    },
    usage: { input_tokens: 670, output_tokens: 88, cost: 0.00002814 },
    ...overrides,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

interface Captured {
  url: string;
  init: RequestInit;
}

/** Replace global fetch with a scripted sequence of responses (or throwers). */
function stubFetch(t: TestContext, script: Array<(init: RequestInit) => Response | Promise<Response>>): Captured[] {
  const calls: Captured[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    assert.ok(step, "fetch called more often than scripted");
    return step(init);
  });
  return calls;
}

const transport = (overrides: Partial<ConstructorParameters<typeof JevTransport>[0]> = {}) =>
  new JevTransport({ projectSwitch: "on", env: ENV, retryBaseMs: 0, ...overrides });

function expectOutcome<K extends JevOutcome["outcome"]>(
  result: JevOutcome,
  outcome: K,
): Extract<JevOutcome, { outcome: K }> {
  assert.equal(result.outcome, outcome, JSON.stringify(result));
  return result as Extract<JevOutcome, { outcome: K }>;
}

test("success: answers, usage, resolved model, attempts and reported cost; the request is the wire contract", async (t) => {
  const calls = stubFetch(t, [() => json(validBody())]);
  const result = expectOutcome(await transport().ask({ stop: "ceiling" }, QUESTIONS), "answered");

  assert.equal(result.resolvedModel, "typesafe/jev-1.13-20260917");
  assert.equal(result.requestedModel, JEV_DEFAULT_MODEL);
  assert.equal(result.attempts, 1);
  assert.equal(result.answers.next_act?.type, "choice");
  assert.deepEqual(result.usage.input_tokens, 670);
  assert.deepEqual(result.cost, { amount: 0.00002814, source: "reported" });
  assert.equal(result.redacted, false);
  assert.ok(result.elapsedMs >= 0);

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.url, JEV_ENDPOINT);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "error");
  assert.equal((call.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(String(call.init.body)), { model: JEV_DEFAULT_MODEL, state: { stop: "ceiling" }, questions: QUESTIONS });
  assert.equal(result.requestText, call.init.body);
});

test("the key is never in the result, its detail, or its request text", async (t) => {
  stubFetch(t, [() => json(validBody())]);
  const answered = await transport().ask("state", QUESTIONS);
  stubFetch(t, [() => new Response("no", { status: 401 })]);
  const refused = await transport().ask("state", QUESTIONS);
  for (const result of [answered, refused]) assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.match(expectOutcome(refused, "unavailable").detail, new RegExp(JEV_KEY_ENV));
});

for (const status of [429, 502, 503, 529]) {
  test(`HTTP ${status} is retried, and a later success answers`, async (t) => {
    const calls = stubFetch(t, [() => new Response("busy", { status }), () => json(validBody())]);
    const result = expectOutcome(await transport().ask("state", QUESTIONS), "answered");
    assert.equal(result.attempts, 2);
    assert.equal(calls.length, 2);
  });
}

test("a retried status is tried at most three times, then is unavailable", async (t) => {
  const calls = stubFetch(t, [() => new Response("busy", { status: 503 })]);
  const result = expectOutcome(await transport().ask("state", QUESTIONS), "unavailable");
  assert.equal(result.reason, "retries-exhausted");
  assert.equal(result.status, 503);
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
});

test("a non-retried 4xx is unavailable after one attempt", async (t) => {
  const calls = stubFetch(t, [() => new Response("bad", { status: 400 }), () => json(validBody())]);
  const result = expectOutcome(await transport().ask("state", QUESTIONS), "unavailable");
  assert.equal(result.reason, "http-status");
  assert.equal(result.status, 400);
  assert.equal(calls.length, 1);
});

test("a network error is unavailable and not retried", async (t) => {
  const calls = stubFetch(t, [
    () => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
    },
  ]);
  const result = expectOutcome(await transport().ask("state", QUESTIONS), "unavailable");
  assert.equal(result.reason, "network");
  assert.equal(calls.length, 1);
});

test("a redirect is refused: redirect is 'error', and the failure is typed", async (t) => {
  const calls = stubFetch(t, [
    (init) => {
      assert.equal(init.redirect, "error");
      throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    },
  ]);
  const result = expectOutcome(await transport().ask("state", QUESTIONS), "unavailable");
  assert.equal(result.reason, "redirect");
  assert.equal(calls.length, 1);
});

test("a timeout is unavailable, and the deadline covers the retries", async (t) => {
  stubFetch(t, [
    (init) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  ]);
  const result = expectOutcome(await transport({ deadlineMs: 20 }).ask("state", QUESTIONS), "unavailable");
  assert.equal(result.reason, "timeout");
  assert.equal(result.attempts, 1);
});

test("a malformed body is a contract error, never a partial answer", async (t) => {
  stubFetch(t, [() => new Response("{not json", { status: 200 })]);
  const result = expectOutcome(await transport().ask("state", QUESTIONS), "contract-error");
  assert.ok(result.error instanceof ContractError);
  assert.equal("answers" in result, false);
});

test("a missing declared answer is a contract error", async (t) => {
  const body = validBody();
  delete (body.answers as Record<string, unknown>).risk;
  stubFetch(t, [() => json(body)]);
  expectOutcome(await transport().ask("state", QUESTIONS), "contract-error");
});

test("an undeclared choice is a contract error", async (t) => {
  const body = validBody();
  (body.answers as Record<string, Record<string, unknown>>).next_act!.choice = "land";
  stubFetch(t, [() => json(body)]);
  const result = expectOutcome(await transport().ask("state", QUESTIONS), "contract-error");
  assert.match(result.error.message, /Undeclared choice/);
});

test("a distribution that does not sum to 1 is a contract error", async (t) => {
  const body = validBody();
  (body.answers as Record<string, Record<string, unknown>>).next_act!.probabilities = { raise: 0.5, wait_for_owner: 0.2, other: 0.05 };
  stubFetch(t, [() => json(body)]);
  const result = expectOutcome(await transport().ask("state", QUESTIONS), "contract-error");
  assert.match(result.error.message, /sum to one/);
});

test("a score out of range or with a foreign legend is a contract error", async (t) => {
  const outOfRange = validBody();
  (outOfRange.answers as Record<string, Record<string, unknown>>).risk!.score = 2.5;
  stubFetch(t, [() => json(outOfRange)]);
  expectOutcome(await transport().ask("state", QUESTIONS), "contract-error");

  const foreignLegend = validBody();
  (foreignLegend.answers as Record<string, Record<string, unknown>>).risk!.legend = { "0": "low", "1": "mid", "2": "high" };
  stubFetch(t, [() => json(foreignLegend)]);
  expectOutcome(await transport().ask("state", QUESTIONS), "contract-error");
});

test("a missing key is a typed unavailable result naming the variable, and nothing is sent", async (t) => {
  const calls = stubFetch(t, [() => json(validBody())]);
  const result = expectOutcome(await transport({ env: {} }).ask("state", QUESTIONS), "unavailable");
  assert.equal(result.reason, "missing-key");
  assert.match(result.detail, new RegExp(JEV_KEY_ENV));
  assert.equal(calls.length, 0);
  assert.equal(transport({ env: { [JEV_KEY_ENV]: "   " } }).available, false);
});

test("the key is read once, at construction", async (t) => {
  const env: Record<string, string | undefined> = { [JEV_KEY_ENV]: KEY };
  const jev = transport({ env });
  env[JEV_KEY_ENV] = undefined;
  stubFetch(t, [() => json(validBody())]);
  expectOutcome(await jev.ask("state", QUESTIONS), "answered");
});

test("the switch turned off is a typed refusal before validation, redaction or egress", async (t) => {
  const calls = stubFetch(t, [() => json(validBody())]);
  const jev = transport({ projectSwitch: "off" });
  assert.equal(jev.available, false);
  const result = expectOutcome(await jev.ask("state", QUESTIONS), "refused-by-switch");
  assert.match(result.detail, /off/);
  assert.equal(calls.length, 0);
});

test("the catalog carries decision.jev, defaulting to on, and rejects anything else", () => {
  const base = [
    "version: awsf.project/v1",
    "project:",
    "  slug: sample",
    "repositories:",
    "  plans:",
    "    role: plan",
    "    default_branch: main",
    "plans:",
    "  root: specs",
    "  format: awsf-plan-html/v1",
  ].join("\n");
  assert.equal(jevSwitchOf(loadCatalog(base)), "on");
  assert.equal(jevSwitchOf(loadCatalog(`${base}\ndecision:\n  jev: on`)), "on");
  assert.equal(jevSwitchOf(loadCatalog(`${base}\ndecision:\n  jev: off`)), "off");
  assert.equal(jevSwitchOf(loadCatalog(`${base}\ndecision: {}`)), "on");
  assert.throws(() => loadCatalog(`${base}\ndecision:\n  jev: maybe`), CatalogSchemaError);
  assert.throws(() => loadCatalog(`${base}\ndecision:\n  typesafe: on`), CatalogSchemaError);
});

test("redaction runs before the body is serialized, and only whether it changed anything is recorded", async (t) => {
  // Assembled at runtime so no credential-shaped literal is committed (invariant 9).
  const secret = "sk-" + "ant-api03-EXAMPLE-NOT-A-REAL-KEY-000000";
  const calls = stubFetch(t, [() => json(validBody())]);
  const stringify = t.mock.method(JSON, "stringify");
  const result = expectOutcome(
    await transport().ask({ log: `token ${secret} leaked`, api_key: "anything" }, QUESTIONS),
    "answered",
  );

  // Every stringify of a value that reached the wire saw it already scrubbed.
  const wireCall = stringify.mock.calls.find((call) => String(call.result).includes(JEV_DEFAULT_MODEL));
  assert.ok(wireCall, "the body was serialized with JSON.stringify");
  assert.equal(String(wireCall.result).includes(secret), false);
  stringify.mock.restore();

  const sent = String(calls[0]?.init.body);
  assert.equal(sent.includes(secret), false);
  assert.ok(sent.includes(REDACTED_VALUE));
  assert.deepEqual(JSON.parse(sent).state, { log: `token ${REDACTED_VALUE} leaked`, api_key: REDACTED_VALUE });
  assert.equal(result.redacted, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("request validation refuses what could never be valid, before anything is sent", async (t) => {
  const calls = stubFetch(t, [() => json(validBody())]);
  const jev = transport();
  const tooMany = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, null]));
  const cases: unknown[] = [
    {},
    { q: { type: "noul", instructions: "   " } },
    { q: { type: "choice", instructions: "pick", criteria: {} } },
    { q: { type: "choice", instructions: "pick", criteria: tooMany } },
    { q: { type: "score", instructions: "rate", criteria: ["only"] } },
    { q: { type: "score", instructions: "rate", criteria: Array.from({ length: 11 }, (_, i) => `l${i}`) } },
    { q: { type: "essay", instructions: "write" } },
  ];
  for (const questions of cases) {
    await assert.rejects(jev.ask("state", questions as JevQuestions), QuestionValidationError);
  }
  assert.equal(calls.length, 0);
});

test("cost: reported when trustworthy, estimated from tokens at the measured rate, otherwise unknown and never zero", () => {
  assert.deepEqual(jevCost({ input_tokens: 670, output_tokens: 88, cost: 0.00002814 }, JEV_RATE), {
    amount: 0.00002814,
    source: "reported",
  });
  const estimated = jevCost({ input_tokens: 670, output_tokens: 88 }, JEV_RATE);
  assert.equal(estimated.source, "estimated");
  assert.ok(Math.abs((estimated.amount ?? NaN) - 0.00002814) < 1e-12);
  assert.equal(jevCost({ input_tokens: 670, output_tokens: 88, cost: -1 }, JEV_RATE).source, "estimated");
  assert.equal(jevCost({ input_tokens: 670, output_tokens: 88, cost: "0.1" }, JEV_RATE).source, "estimated");
  assert.deepEqual(jevCost({ input_tokens: 670, output_tokens: 88 }, null), { amount: null, source: "unknown" });
  assert.equal(JEV_RATE.inputPerMillion, 0.042);
  assert.equal(JEV_RATE.outputPerMillion, 0);
});

test("an unreported cost is estimated in an answered call, and unknown when no rate is configured", async (t) => {
  const body = validBody({ usage: { input_tokens: 1_000_000, output_tokens: 5 } });
  stubFetch(t, [() => json(body)]);
  assert.deepEqual(expectOutcome(await transport().ask("s", QUESTIONS), "answered").cost, {
    amount: 0.042,
    source: "estimated",
  });
  stubFetch(t, [() => json(body)]);
  assert.deepEqual(expectOutcome(await transport({ rate: null }).ask("s", QUESTIONS), "answered").cost, {
    amount: null,
    source: "unknown",
  });
});

// The only module in AWSF that calls the Jev endpoint (AGENTS.md invariant 13,
// W19 DD1, INV-4). Enforced by core/test/unit/meta/jev-transport-fence.test.ts.
//
// Jev is a hosted classifier: a state and typed questions in, typed answers
// out. This transport is a port of the reference client's wire contract and
// validation, cut to one provider (OpenRouter) and bound to AWSF's rules:
// redaction before egress, a per-project switch, a key read once from the
// environment, and a typed outcome for every way a call can end. Nothing here
// decides anything from an answer; code downstream does.

import { scrubCredentials } from "../policy/redaction.ts";
import type { JevSwitch } from "../registry/catalog-schema.ts";

export const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
/** The moving alias (Q7). The resolved model is returned on every answered call. */
export const JEV_DEFAULT_MODEL = "~typesafe/jev-latest";
/** The only credential source (Q6). Never a file, never pi's auth.json. */
export const JEV_KEY_ENV = "OPENROUTER_API_KEY";

export const JEV_RETRY_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 529]);
export const JEV_MAX_ATTEMPTS = 3;
/** Total budget for one call, including retries, backoff and the response body. */
export const JEV_DEADLINE_MS = 30_000;
export const JEV_MAX_BACKOFF_MS = 8_000;
const DEFAULT_RETRY_BASE_MS = 500;

/** USD per million tokens. */
export interface JevRate {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  /** When the rate was measured, so an estimate can say how old it is. */
  readonly measuredAt: string;
}

/**
 * The only configured rate: the 2026-09-28 smoke reported $0.00002814 for 670
 * input and 88 output tokens, which is exactly $0.042 per million input tokens
 * with output free.
 */
export const JEV_RATE: JevRate = Object.freeze({
  inputPerMillion: 0.042,
  outputPerMillion: 0,
  measuredAt: "2026-09-28",
});

export const JEV_LIMITS = Object.freeze({
  MAX_CHOICE_OPTIONS: 255,
  MIN_SCORE_LEVELS: 2,
  MAX_SCORE_LEVELS: 10,
  DISTRIBUTION_TOLERANCE: 0.025,
});

// ---------------------------------------------------------------------------
// Wire contract (ported from the reference client's types.ts)

export type JevState = string | Record<string, unknown> | unknown[];
export type JevInstructions = string | Record<string, unknown>;

export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions: JevInstructions;
  readonly criteria?: { readonly true?: string; readonly false?: string };
}

export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: JevInstructions;
  /** Option -> rubric description, or null when the option needs none. */
  readonly criteria: Readonly<Record<string, string | null>>;
}

export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: JevInstructions;
  /** Ordered level descriptions, low to high. */
  readonly criteria: readonly string[];
}

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;
/** Question ids are for code; they are not used in inference. */
export type JevQuestions = Readonly<Record<string, JevQuestion>>;

export interface NoulAnswer {
  readonly type: "noul";
  readonly noul: number;
}

export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: "score";
  readonly score: number;
  readonly legend: Readonly<Record<string, string>>;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cost?: unknown;
  readonly [key: string]: unknown;
}

export type JevCost =
  | { readonly amount: number; readonly source: "reported" | "estimated" }
  | { readonly amount: null; readonly source: "unknown" };

// ---------------------------------------------------------------------------
// Errors and outcomes

/** A request that could never be valid: a caller defect, thrown before anything is sent. */
export class QuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionValidationError";
  }
}

/** A response that breaks the declared contract. Never a partial answer. */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export type JevUnavailableReason =
  | "missing-key"
  | "http-status"
  | "retries-exhausted"
  | "network"
  | "redirect"
  | "timeout"
  | "aborted";

interface CallFacts {
  readonly requestedModel: string;
  readonly elapsedMs: number;
  readonly attempts: number;
  /** Whether redaction changed the outgoing body. What it removed is never kept. */
  readonly redacted: boolean;
  /** The redacted request body exactly as sent. */
  readonly requestText: string;
}

export interface JevAnswered extends CallFacts {
  readonly outcome: "answered";
  readonly answers: Readonly<Record<string, JevAnswer>>;
  readonly usage: JevUsage;
  readonly resolvedModel: string;
  readonly cost: JevCost;
  readonly responseText: string;
}

export interface JevContractFailure extends CallFacts {
  readonly outcome: "contract-error";
  readonly error: ContractError;
  readonly responseText: string;
}

export interface JevUnavailable extends Partial<CallFacts> {
  readonly outcome: "unavailable";
  readonly reason: JevUnavailableReason;
  /** Operator-facing and credential-free: never the key, a header, or redacted material. */
  readonly detail: string;
  readonly status?: number;
}

export interface JevRefused {
  readonly outcome: "refused-by-switch";
  readonly detail: string;
}

export type JevOutcome = JevAnswered | JevContractFailure | JevUnavailable | JevRefused;

// ---------------------------------------------------------------------------
// Validation (ported from the reference client)

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isUnit = (value: unknown): value is number => isNonNegative(value) && value <= 1;
const isTokenCount = (value: unknown): value is number => isNonNegative(value) && Number.isSafeInteger(value);

export function validateJevRequest(state: unknown, questions: unknown, model: unknown): void {
  if (typeof state !== "string" && !isPlainRecord(state) && !Array.isArray(state)) {
    throw new QuestionValidationError("State must be a string, object, or array.");
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new QuestionValidationError("Model must be a nonblank string.");
  }
  validateJevQuestions(questions);
}

export function validateJevQuestions(questions: unknown): asserts questions is JevQuestions {
  if (!isPlainRecord(questions) || Object.keys(questions).length === 0) {
    throw new QuestionValidationError("Questions must be a nonempty object.");
  }
  for (const [id, q] of Object.entries(questions)) {
    if (!isPlainRecord(q)) throw new QuestionValidationError(`Question "${id}" must be an object.`);
    if (q.type !== "noul" && q.type !== "choice" && q.type !== "score") {
      throw new QuestionValidationError(`Question "${id}" has a missing or unknown type.`);
    }
    if (typeof q.instructions === "string" ? !q.instructions.trim() : !isPlainRecord(q.instructions)) {
      throw new QuestionValidationError(`Question "${id}" needs nonblank string or object instructions.`);
    }
    if (q.type === "noul" && q.criteria !== undefined) {
      if (
        !isPlainRecord(q.criteria) ||
        Object.entries(q.criteria).some(
          ([key, value]) => !["true", "false"].includes(key) || (value !== undefined && typeof value !== "string"),
        )
      ) {
        throw new QuestionValidationError(`Noul "${id}" criteria must map true/false to descriptions.`);
      }
    }
    if (q.type === "choice") {
      if (!isPlainRecord(q.criteria)) throw new QuestionValidationError(`Choice "${id}" criteria must be an object.`);
      const options = Object.keys(q.criteria);
      if (options.length === 0) throw new QuestionValidationError(`Choice "${id}" has no options.`);
      if (options.length > JEV_LIMITS.MAX_CHOICE_OPTIONS) {
        throw new QuestionValidationError(
          `Choice "${id}" has ${options.length} options; the maximum is ${JEV_LIMITS.MAX_CHOICE_OPTIONS}.`,
        );
      }
      if (Object.values(q.criteria).some((value) => value !== null && typeof value !== "string")) {
        throw new QuestionValidationError(`Choice "${id}" descriptions must be strings or null.`);
      }
    }
    if (q.type === "score") {
      if (!Array.isArray(q.criteria)) throw new QuestionValidationError(`Score "${id}" criteria must be an array.`);
      if (q.criteria.length < JEV_LIMITS.MIN_SCORE_LEVELS || q.criteria.length > JEV_LIMITS.MAX_SCORE_LEVELS) {
        throw new QuestionValidationError(
          `Score "${id}" must have between ${JEV_LIMITS.MIN_SCORE_LEVELS} and ${JEV_LIMITS.MAX_SCORE_LEVELS} levels; got ${q.criteria.length}.`,
        );
      }
      if (q.criteria.some((level: unknown) => typeof level !== "string" || !level.trim())) {
        throw new QuestionValidationError(`Score "${id}" levels must be nonblank strings.`);
      }
    }
  }
}

interface ValidResponse {
  readonly model: string;
  readonly answers: Readonly<Record<string, JevAnswer>>;
  readonly usage: JevUsage;
}

/** Strict: every declared answer present with its declared type and shape. */
export function validateJevResponse(response: unknown, questions: JevQuestions): asserts response is ValidResponse {
  if (!isObject(response) || !isObject(response.answers) || typeof response.model !== "string" || !response.model.trim()) {
    throw new ContractError("Invalid response envelope: expected model and answers.");
  }
  if (!isObject(response.usage) || !isTokenCount(response.usage.input_tokens) || !isTokenCount(response.usage.output_tokens)) {
    throw new ContractError("Invalid response usage: expected nonnegative integer input_tokens and output_tokens.");
  }
  for (const [id, q] of Object.entries(questions)) {
    const answer = response.answers[id];
    if (!Object.hasOwn(response.answers, id) || !isObject(answer) || answer.type !== q.type) {
      throw new ContractError(`Missing or mismatched answer: ${id}`);
    }
    if (q.type === "noul") {
      if (!isUnit(answer.noul)) throw new ContractError(`Invalid noul: ${id}`);
      continue;
    }
    if (!isUnit(answer.confidence) || !isObject(answer.probabilities)) {
      throw new ContractError(`Invalid distribution: ${id}`);
    }
    const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, index) => String(index));
    const probabilities = answer.probabilities;
    if (
      Object.keys(probabilities).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(probabilities, key) && isUnit(probabilities[key]))
    ) {
      throw new ContractError(`Distribution keys must match the declared criteria: ${id}`);
    }
    const sum = keys.reduce((total, key) => total + (probabilities[key] as number), 0);
    if (Math.abs(sum - 1) > JEV_LIMITS.DISTRIBUTION_TOLERANCE) {
      throw new ContractError(`Distribution does not sum to one: ${id} (${sum})`);
    }
    if (q.type === "choice" && (typeof answer.choice !== "string" || !keys.includes(answer.choice))) {
      throw new ContractError(`Undeclared choice returned: ${id}`);
    }
    if (q.type === "score") {
      if (!isNonNegative(answer.score) || answer.score > keys.length - 1) {
        throw new ContractError(`Score out of range: ${id}`);
      }
      const legend = answer.legend;
      if (
        !isObject(legend) ||
        Object.keys(legend).length !== keys.length ||
        !keys.every((key, index) => Object.hasOwn(legend, key) && legend[key] === q.criteria[index])
      ) {
        throw new ContractError(`Score legend must match the declared criteria: ${id}`);
      }
    }
  }
}

/** Reported when the provider gives a finite non-negative cost; estimated from tokens; else unknown, never zero. */
export function jevCost(usage: JevUsage, rate: JevRate | null): JevCost {
  if (isNonNegative(usage.cost)) return { amount: usage.cost, source: "reported" };
  if (rate !== null) {
    const amount =
      (usage.input_tokens / 1_000_000) * rate.inputPerMillion + (usage.output_tokens / 1_000_000) * rate.outputPerMillion;
    if (isNonNegative(amount)) return { amount, source: "estimated" };
  }
  return { amount: null, source: "unknown" };
}

// ---------------------------------------------------------------------------
// The transport

export interface JevTransportOptions {
  /** The project's switch (`jevSwitchOf(catalog)`). Required so no caller defaults past it. */
  readonly projectSwitch: JevSwitch;
  /** Where the key is read from, once. Defaults to process.env; tests pass their own. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Pin a versioned model instead of the moving alias. */
  readonly model?: string;
  /** Total deadline including retries. Default and ceiling: 30 s. */
  readonly deadlineMs?: number;
  /** Backoff base before jitter. Default 500 ms; tests pass 0. */
  readonly retryBaseMs?: number;
  /** Rate for estimates; null means an unreported cost is unknown. Default JEV_RATE. */
  readonly rate?: JevRate | null;
}

export interface JevAskOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
}

export class JevTransport {
  readonly #projectSwitch: JevSwitch;
  readonly #key: string | undefined;
  readonly #model: string;
  readonly #deadlineMs: number;
  readonly #retryBaseMs: number;
  readonly #rate: JevRate | null;

  constructor(options: JevTransportOptions) {
    if (options.projectSwitch !== "on" && options.projectSwitch !== "off") {
      throw new Error(`projectSwitch must be "on" or "off".`);
    }
    this.#projectSwitch = options.projectSwitch;
    const key = (options.env ?? process.env)[JEV_KEY_ENV]?.trim();
    this.#key = key ? key : undefined;
    this.#model = options.model ?? JEV_DEFAULT_MODEL;
    const deadlineMs = options.deadlineMs ?? JEV_DEADLINE_MS;
    if (!Number.isInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > JEV_DEADLINE_MS) {
      throw new Error(`deadlineMs must be a positive integer no greater than ${JEV_DEADLINE_MS}.`);
    }
    this.#deadlineMs = deadlineMs;
    const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    if (!isNonNegative(retryBaseMs)) throw new Error("retryBaseMs must be finite and nonnegative.");
    this.#retryBaseMs = retryBaseMs;
    const rate = options.rate === undefined ? JEV_RATE : options.rate;
    if (rate !== null && (!isNonNegative(rate.inputPerMillion) || !isNonNegative(rate.outputPerMillion))) {
      throw new Error("rate needs finite, nonnegative inputPerMillion and outputPerMillion.");
    }
    this.#rate = rate === null ? null : Object.freeze({ ...rate });
  }

  /** Whether a call could leave at all: the switch is on and the key is present. */
  get available(): boolean {
    return this.#projectSwitch === "on" && this.#key !== undefined;
  }

  /**
   * Ask Jev. Every ending is a typed outcome; only a request that could never be
   * valid throws (QuestionValidationError), before anything is sent.
   */
  async ask(state: JevState, questions: JevQuestions, options: JevAskOptions = {}): Promise<JevOutcome> {
    if (this.#projectSwitch === "off") {
      return { outcome: "refused-by-switch", detail: "Jev is switched off for this project (decision.jev: off)." };
    }
    const requestedModel = options.model ?? this.#model;
    validateJevRequest(state, questions, requestedModel);

    // Redaction runs on the values before the body is serialized, so nothing
    // unredacted is ever turned into wire text.
    const scrubbedState = scrubCredentials(state);
    const scrubbedQuestions = scrubCredentials(questions);
    const redacted =
      safeStringify(scrubbedState) !== safeStringify(state) ||
      safeStringify(scrubbedQuestions) !== safeStringify(questions);
    let requestText: string;
    try {
      requestText = JSON.stringify({ model: requestedModel, state: scrubbedState, questions: scrubbedQuestions });
    } catch {
      throw new QuestionValidationError("Request must be JSON-serializable (no cycles or BigInt).");
    }
    // Validate the wire snapshot too: a toJSON method can change what is sent.
    const sent = JSON.parse(requestText) as { state: unknown; questions: unknown; model: unknown };
    validateJevRequest(sent.state, sent.questions, sent.model);
    const sentQuestions = sent.questions as JevQuestions;

    if (this.#key === undefined) {
      return {
        outcome: "unavailable",
        reason: "missing-key",
        detail: `${JEV_KEY_ENV} is not set; Jev is unavailable and the caller's fallback applies.`,
        requestedModel,
        attempts: 0,
        elapsedMs: 0,
        redacted,
        requestText,
      };
    }

    const started = performance.now();
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort(new DOMException("Jev deadline exceeded.", "TimeoutError"));
    }, this.#deadlineMs);
    const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
    let attempts = 0;
    const facts = (): CallFacts => ({
      requestedModel,
      elapsedMs: Math.round(performance.now() - started),
      attempts,
      redacted,
      requestText,
    });

    try {
      for (;;) {
        attempts += 1;
        signal.throwIfAborted();
        const response = await fetch(JEV_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.#key}`, "Content-Type": "application/json" },
          body: requestText,
          signal,
          redirect: "error",
        });
        if (JEV_RETRY_STATUSES.has(response.status)) {
          await response.body?.cancel();
          if (attempts >= JEV_MAX_ATTEMPTS) {
            return {
              outcome: "unavailable",
              reason: "retries-exhausted",
              status: response.status,
              detail: `Jev returned HTTP ${response.status} on all ${attempts} attempts.`,
              ...facts(),
            };
          }
          const backoff = this.#retryBaseMs * 2 ** (attempts - 1) * (1 + Math.random() * 0.2);
          const delay = Math.min(JEV_MAX_BACKOFF_MS, Math.max(backoff, retryAfterMs(response.headers.get("retry-after"))));
          await sleep(delay, signal);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          const hint =
            response.status === 401 ? ` Check ${JEV_KEY_ENV}.` : response.status === 402 ? " Check account credits." : "";
          return {
            outcome: "unavailable",
            reason: "http-status",
            status: response.status,
            detail: `Jev returned HTTP ${response.status}.${hint}`,
            ...facts(),
          };
        }
        const responseText = await response.text();
        signal.throwIfAborted();
        let body: unknown;
        try {
          body = JSON.parse(responseText);
        } catch {
          return { outcome: "contract-error", error: new ContractError("Invalid response JSON."), responseText, ...facts() };
        }
        try {
          validateJevResponse(body, sentQuestions);
        } catch (error) {
          if (!(error instanceof ContractError)) throw error;
          return { outcome: "contract-error", error, responseText, ...facts() };
        }
        return {
          outcome: "answered",
          answers: body.answers,
          usage: body.usage,
          resolvedModel: body.model,
          cost: jevCost(body.usage, this.#rate),
          responseText,
          ...facts(),
        };
      }
    } catch (error) {
      return { outcome: "unavailable", ...classifyFailure(error, deadline.signal), ...facts() };
    } finally {
      clearTimeout(timer);
    }
  }
}

function classifyFailure(
  error: unknown,
  deadline: AbortSignal,
): { reason: JevUnavailableReason; detail: string } {
  if (deadline.aborted) {
    return { reason: "timeout", detail: "Jev did not answer inside the deadline." };
  }
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { reason: "aborted", detail: "The caller aborted the Jev call." };
  }
  // Undici reports a refused redirect as a TypeError whose cause names it.
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeText = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  if (/redirect/i.test(causeText) || (error instanceof Error && /redirect/i.test(error.message))) {
    return { reason: "redirect", detail: "Jev answered with a redirect, which is refused." };
  }
  const name = error instanceof Error ? error.name : "unknown";
  return { reason: "network", detail: `The Jev request failed before a response (${name}).` };
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Ignores malformed or negative values instead of letting NaN erase the backoff. */
function retryAfterMs(header: string | null): number {
  if (!header?.trim()) return 0;
  const value = header.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isFinite(ms) ? ms : 0;
  }
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(value)) return 0;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

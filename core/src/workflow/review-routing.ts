import type { ReviewRouteMode } from "../contracts/route-selection.ts";

export class InvalidReviewInversion extends Error {
  constructor(detail: string) {
    super(`review inversion is invalid: ${detail}`);
    this.name = "InvalidReviewInversion";
  }
}

export class MandatoryReviewUnavailable extends Error {
  readonly workerProvider: string;
  readonly reviewProvider: string;
  readonly reviewMode: ReviewRouteMode;
  readonly attemptedProviders: readonly string[];
  readonly transportRetries = 1;
  readonly substituteAttempted = false;
  readonly cause: unknown;

  constructor(
    workerProvider: string,
    reviewProvider: string,
    attempts: readonly string[],
    cause: unknown,
    reviewMode: ReviewRouteMode = "invert-provider",
  ) {
    const description = reviewMode === "same-provider-degraded"
      ? "explicit degraded same-provider review"
      : "mandatory opposite-provider review";
    super(
      `${description} on ${JSON.stringify(reviewProvider)} remained unavailable ` +
        "after one transport retry; no substitute was attempted",
    );
    this.name = "MandatoryReviewUnavailable";
    this.workerProvider = workerProvider;
    this.reviewProvider = reviewProvider;
    this.reviewMode = reviewMode;
    this.attemptedProviders = Object.freeze([...attempts]);
    this.cause = cause;
  }
}

/**
 * The exclusion above needs a pair, and the pair is a property of the configured
 * route surface rather than of any one agent. Blank names are dropped because an
 * adapter kind with no provider (the fixture route) names no provider at all;
 * anything other than exactly two distinct providers leaves inversion undefined,
 * and an undefined inversion must be refused rather than guessed.
 */
export function providerPairFrom(providers: readonly string[]): readonly [string, string] {
  const distinct = [...new Set(providers.map((provider) => provider.trim()).filter((provider) => provider.length > 0))];
  if (distinct.length !== 2) {
    throw new InvalidReviewInversion(
      `inversion needs exactly two distinct providers on the configured route surface; found ${distinct.length}` +
        (distinct.length === 0 ? "" : ` (${distinct.join(", ")})`),
    );
  }
  return [distinct[0]!, distinct[1]!] as const;
}

/** Resolves a two-provider route by exclusion; quota and availability are never inputs. */
export function oppositeProvider(
  workerProvider: string,
  providers: readonly [string, string],
): string {
  const [first, second] = providers;
  if (first.trim().length === 0 || second.trim().length === 0 || first === second) {
    throw new InvalidReviewInversion("the configured provider pair must contain two distinct non-blank providers");
  }
  if (workerProvider === first) return second;
  if (workerProvider === second) return first;
  throw new InvalidReviewInversion(
    `worker provider ${JSON.stringify(workerProvider)} is not in the configured pair`,
  );
}

export interface MandatoryReviewOptions<T> {
  readonly workerProvider: string;
  /** Required by the default inversion route; not consulted by explicit degraded mode. */
  readonly providers?: readonly [string, string];
  /** Omission is the safe default. The degraded mode can only be named explicitly. */
  readonly mode?: ReviewRouteMode;
  /** Called at most twice, always with the one provider selected by inversion. */
  execute(reviewProvider: string, attempt: 1 | 2): Promise<T>;
  isTransportFailure(error: unknown): boolean;
  /**
   * A failure to speak the envelope contract, which a COLD reviewer can recover
   * from by simply being asked again.
   *
   * Optional, and absent by default, because it is only sound where the route
   * has no continuity. A resumable reviewer re-asked mid-conversation is being
   * argued with; a `continuity: "none"` reviewer holds no state, so a second
   * turn is a fresh opinion rather than a revised one. `awsf review` supplies
   * it and the production runner does not — there, a phase's own correction
   * allowance owns this decision, and `authorizeCorrection` already refuses a
   * route with no continuity.
   *
   * Exhausting it does NOT raise `MandatoryReviewUnavailable`: the review was
   * available and answered twice. The second failure is rethrown as itself, so
   * the caller classifies a malformed review as malformed.
   */
  isContractFailure?(error: unknown): boolean;
}

/**
 * One fixed-route attempt plus one retry. There is no fallback callback.
 *
 * The retry is spent on a transport fault, or — where the caller declares the
 * route cold — on a response that did not validate. Both are the provider
 * failing to deliver an answer rather than delivering one the host dislikes,
 * and the single held call exists for exactly that.
 */
export async function runMandatoryReview<T>(options: MandatoryReviewOptions<T>): Promise<T> {
  const mode = options.mode ?? "invert-provider";
  const reviewProvider = mode === "same-provider-degraded"
    ? options.workerProvider
    : oppositeProvider(
        options.workerProvider,
        options.providers ?? (() => { throw new InvalidReviewInversion("the default review route has no provider pair"); })(),
      );
  const attempts: string[] = [];
  for (const attempt of [1, 2] as const) {
    attempts.push(reviewProvider);
    try {
      return await options.execute(reviewProvider, attempt);
    } catch (error) {
      if (options.isTransportFailure(error)) {
        if (attempt === 2) {
          throw new MandatoryReviewUnavailable(
            options.workerProvider,
            reviewProvider,
            attempts,
            error,
            mode,
          );
        }
        continue;
      }
      if (attempt === 1 && options.isContractFailure?.(error) === true) continue;
      throw error;
    }
  }
  throw new Error("unreachable mandatory review retry state");
}

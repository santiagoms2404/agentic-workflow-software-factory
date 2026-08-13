export class InvalidReviewInversion extends Error {
  constructor(detail: string) {
    super(`review inversion is invalid: ${detail}`);
    this.name = "InvalidReviewInversion";
  }
}

export class MandatoryReviewUnavailable extends Error {
  readonly workerProvider: string;
  readonly reviewProvider: string;
  readonly attemptedProviders: readonly string[];
  readonly transportRetries = 1;
  readonly substituteAttempted = false;
  readonly cause: unknown;

  constructor(workerProvider: string, reviewProvider: string, attempts: readonly string[], cause: unknown) {
    super(
      `mandatory opposite-provider review on ${JSON.stringify(reviewProvider)} remained unavailable ` +
        "after one transport retry; no substitute was attempted",
    );
    this.name = "MandatoryReviewUnavailable";
    this.workerProvider = workerProvider;
    this.reviewProvider = reviewProvider;
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
  readonly providers: readonly [string, string];
  /** Called at most twice, always with the one provider selected by inversion. */
  execute(reviewProvider: string, attempt: 1 | 2): Promise<T>;
  isTransportFailure(error: unknown): boolean;
}

/** One fixed-route attempt plus one transport retry. There is no fallback callback. */
export async function runMandatoryReview<T>(options: MandatoryReviewOptions<T>): Promise<T> {
  const reviewProvider = oppositeProvider(options.workerProvider, options.providers);
  const attempts: string[] = [];
  for (const attempt of [1, 2] as const) {
    attempts.push(reviewProvider);
    try {
      return await options.execute(reviewProvider, attempt);
    } catch (error) {
      if (!options.isTransportFailure(error)) throw error;
      if (attempt === 2) {
        throw new MandatoryReviewUnavailable(
          options.workerProvider,
          reviewProvider,
          attempts,
          error,
        );
      }
    }
  }
  throw new Error("unreachable mandatory review retry state");
}

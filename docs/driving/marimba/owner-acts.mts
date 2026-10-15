/**
 * The acts the lifecycle reserves for the owner, declared once, as data.
 *
 * An owner act is a CLI invocation that builds an owner terminal
 * (`processOwnerTerminal()`). Until B5-05 the list was the `case` arms of
 * `core/src/cli/main.ts` that build one, read out of the source text, and three
 * acts that build theirs elsewhere were in neither the list nor either guard:
 * `seed` (an `if (command === "seed")` block), `group apply` (built inside
 * `commands/group.ts`) and `retry --adopt-as` (built by the `adoptionTerminal`
 * helper, and only when the flag is given). So the list is now written here and
 * everything else derives from it:
 *
 *   - `marimba-guard-rules.mts` builds both harnesses' owner-act fence from it,
 *     and `delegation-guard.sh` is held to the same entries by the meta-tests;
 *   - `boundary-claims.test.ts` asserts that every `processOwnerTerminal()` call
 *     site in `core/src` maps to exactly one entry here, and every entry to a
 *     call site, so an act added in a new shape fails on the code, not on a
 *     driving session finding the gap.
 *
 * This file imports nothing, for the reason `marimba-guard-rules.mts` gives:
 * a meta-test and a harness binding can both load it without a runtime.
 */

/**
 * Where `core/src/cli/main.ts` builds the act's owner terminal. The fence uses
 * it to say which shape of call site it expects for the entry.
 *
 * - `case-arm`: directly inside the act's `case "<verb>":` arm.
 * - `if-block`: inside an `if (command === "<verb>")` block before the switch.
 * - `helper`: inside a named helper called from the act's arm.
 * - `module`: inside the command module the CLI loads for the act.
 */
export type OwnerActReach = "case-arm" | "if-block" | "helper" | "module";

export interface OwnerActEntry {
  /** The words after `awsf` that invoke the act. */
  readonly verb: string;
  /** A flag that makes the verb an owner act. Absent: the verb alone is one. */
  readonly flag?: string;
  readonly reach: OwnerActReach;
}

/**
 * The case-arm entries keep the order the shell guard's `for verb` loop has
 * always had, because the pi meta-test compares that loop in order.
 */
export const OWNER_ACT_LIST: readonly OwnerActEntry[] = [
  { verb: "land", reach: "case-arm" },
  { verb: "cancel", reach: "case-arm" },
  { verb: "rework", reach: "case-arm" },
  { verb: "review", reach: "case-arm" },
  { verb: "degrade-review", reach: "case-arm" },
  { verb: "attribute", reach: "case-arm" },
  { verb: "prove", reach: "case-arm" },
  { verb: "journey", reach: "case-arm" },
  { verb: "raise", reach: "case-arm" },
  { verb: "publish", reach: "case-arm" },
  { verb: "resume", reach: "case-arm" },
  { verb: "grant", reach: "case-arm" },
  { verb: "confirm", reach: "case-arm" },
  { verb: "close", reach: "case-arm" },
  { verb: "seed", reach: "if-block" },
  { verb: "group apply", reach: "module" },
  // Plain `retry` builds no terminal and stays open to a driving session; only
  // adoption asks the owner (adopt.ts refuses a non-interactive terminal).
  { verb: "retry", flag: "--adopt-as", reach: "helper" },
];

/** The name a denial reports and a document uses: the verb, then any flag. */
export function ownerActName(entry: OwnerActEntry): string {
  return entry.flag === undefined ? entry.verb : `${entry.verb} ${entry.flag}`;
}

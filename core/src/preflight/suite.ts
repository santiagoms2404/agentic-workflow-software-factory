// K1's suite fact (specs/awsf-v3-w01-driver-checks.html, K1's fields and W01-Q5):
// a row for every configured gate at exactly the base L1 would pin, under the
// current gate configuration digest.
//
// Reused when a landed attempt's candidate IS that base and it measured every
// configured gate under the same digest: after a factory landing, the landed
// candidate's rows are the base's rows, so nothing runs. Failing that, reused
// from an earlier driver-preflight record of this task or its continuation
// chain whose rows are one passing row per configured gate at exactly the base
// under the same digest: after a direct commit the suite costs one host run per
// base, not one per preflight. Otherwise every configured gate runs once in the project's
// baseline worktree, through the transport broker, with the configured
// timeout. A gathering that cannot produce rows says why in the host's words;
// `evaluateSuite` turns that into the refusal.

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gatesConfigDigest } from "../contracts/command-ledger.ts";
import type { DriverPreflightRecord, PreflightSuite, SuiteGateRow } from "../contracts/driver-preflight.ts";
import type { AwsfConfig } from "../config/schema.ts";
import { runSystemCommand } from "../execution/transport-broker.ts";
import { runGit, systemGitRunner } from "../git/changes.ts";
import type { AttemptEvidence } from "../observability/attempt-evidence.ts";
import { prepareBaselineWorktree, type BaselineWorktree } from "./baseline-worktree.ts";

export type GateCommandRunner = typeof runSystemCommand;

/** A landed attempt whose candidate is the base, read from its status and journal. */
export interface LandedMeasurement {
  readonly label: string;
  readonly candidateSha: string;
  readonly evidence: readonly AttemptEvidence[];
}

/**
 * The landed attempt's own rows at the base: per configured gate, the latest
 * settled dispatch whose candidate is the base and whose gate configuration
 * digest is the current one. Null unless every configured gate has one, so a
 * partial measurement is never mistaken for the suite.
 */
export function landedSuiteRows(landed: LandedMeasurement, baseSha: string, config: Pick<AwsfConfig, "gates">): readonly SuiteGateRow[] | null {
  if (landed.candidateSha !== baseSha) return null;
  const digest = gatesConfigDigest(config.gates);
  const intents = new Map<string, Extract<AttemptEvidence, { type: "command-dispatch-intent" }>["intent"]>();
  const rows = new Map<string, SuiteGateRow>();
  for (const evidence of landed.evidence) {
    if (evidence.type === "command-dispatch-intent") {
      if (evidence.intent.candidateSha === baseSha && evidence.intent.gatesConfigDigest === digest) intents.set(evidence.intent.intentId, evidence.intent);
    } else if (evidence.type === "command-dispatch-result") {
      const intent = intents.get(evidence.result.intentId);
      if (intent === undefined) continue;
      const exited = evidence.result.outcome === "exited";
      rows.set(intent.gateId, {
        gateId: intent.gateId, sha: intent.candidateSha, gatesConfigDigest: intent.gatesConfigDigest,
        passed: exited && evidence.result.exitCode === 0 && evidence.result.cleanAfter,
        exitCode: exited ? evidence.result.exitCode : null,
      });
    }
  }
  const ordered = Object.keys(config.gates).map((gateId) => rows.get(gateId));
  return ordered.every((row) => row !== undefined) ? Object.freeze(ordered as SuiteGateRow[]) : null;
}

/** An earlier driver-preflight record of this task or its continuation chain, read from its attempt's journal. */
export interface PreflightMeasurement {
  readonly label: string;
  readonly record: DriverPreflightRecord;
}

/**
 * An earlier preflight's rows, when they are the suite at the base: exactly one
 * row per configured gate and no other, each at the base, under the current gate
 * configuration digest, and each passed. Null otherwise, so a red, partial or
 * stale record is never reused and the suite runs.
 */
export function preflightSuiteRows(earlier: PreflightMeasurement, baseSha: string, config: Pick<AwsfConfig, "gates">): readonly SuiteGateRow[] | null {
  const rows = earlier.record.suite?.rows;
  const gateIds = Object.keys(config.gates);
  if (rows === undefined || rows.length !== gateIds.length) return null;
  const digest = gatesConfigDigest(config.gates);
  const ordered: SuiteGateRow[] = [];
  for (const gateId of gateIds) {
    const matching = rows.filter((row) => row.gateId === gateId);
    const row = matching[0];
    if (matching.length !== 1 || row === undefined) return null;
    if (row.sha !== baseSha || row.gatesConfigDigest !== digest || !row.passed) return null;
    ordered.push({ ...row });
  }
  return Object.freeze(ordered);
}

export interface BaselineSuiteRequest {
  readonly repository: string;
  readonly worktreeRoot: string;
  readonly project: string;
  readonly baseSha: string;
  readonly config: Pick<AwsfConfig, "gates" | "runtime" | "policy">;
  /** Where each gate's complete output is retained, mode 0600. */
  readonly outputDir: string;
  readonly runCommand?: GateCommandRunner;
}

export interface GateRun {
  readonly gateId: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly outputPath: string;
}

export interface SuiteGathering {
  readonly suite: PreflightSuite | null;
  /** Why no row could be gathered, when `suite` is null. */
  readonly unavailable: string | null;
  /** The landed attempt or earlier preflight record reused, when no gate ran. */
  readonly reused: string | null;
  /** What `reused` names: a landed attempt's rows, or an earlier driver-preflight record's. */
  readonly reusedFrom: "landed-attempt" | "driver-preflight" | null;
  readonly baseline: BaselineWorktree | null;
  readonly runs: readonly GateRun[];
}

function detail(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Runs every configured gate once in the baseline worktree, in configuration
 * order. A gate that leaves the tree dirty or moves its HEAD ends the run: the
 * tree is left exactly as the gate left it, and the gathering reports it rather
 * than recording a row measured anywhere but the clean base.
 */
export async function runBaselineSuite(request: BaselineSuiteRequest): Promise<SuiteGathering> {
  const runCommand = request.runCommand ?? runSystemCommand;
  let baseline: BaselineWorktree;
  try {
    baseline = await prepareBaselineWorktree({
      repository: request.repository, root: request.worktreeRoot, project: request.project, baseSha: request.baseSha,
      seedPaths: request.config.runtime.seed_paths, protectedPaths: request.config.policy.protected_paths,
    });
  } catch (error) {
    return Object.freeze({ suite: null, unavailable: `the baseline worktree was refused, and no gate ran: ${detail(error)}`, reused: null, reusedFrom: null, baseline: null, runs: [] });
  }
  const digest = gatesConfigDigest(request.config.gates);
  const tree = systemGitRunner(baseline.path);
  const rows: SuiteGateRow[] = [];
  const runs: GateRun[] = [];
  for (const [gateId, gate] of Object.entries(request.config.gates)) {
    const [executable, ...argv] = gate.argv;
    const started = Date.now();
    const result = runCommand(executable!, argv, {
      timeoutMs: gate.timeout_seconds * 1_000, cwd: baseline.path, maxBuffer: request.config.runtime.max_output_bytes,
    });
    const durationMs = Date.now() - started;
    const outputPath = join(request.outputDir, `preflight-${gateId}.txt`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${result.stdout}${result.stderr}${result.error === null ? "" : `\n${result.error}`}`, { mode: 0o600 });
    await chmod(outputPath, 0o600);
    runs.push({ gateId, exitCode: result.status, durationMs, outputPath });
    const status = runGit(tree, ["status", "--porcelain"]).trim();
    const head = runGit(tree, ["rev-parse", "HEAD"]).trim();
    if (status.length > 0 || head !== baseline.head) {
      const what = status.length > 0 ? "left it dirty" : `moved its HEAD to ${head}`;
      return Object.freeze({
        suite: null, reused: null, reusedFrom: null, baseline, runs: Object.freeze(runs),
        unavailable: `gate ${gateId} ${what} in the baseline worktree ${baseline.path}; it is refused, not cleaned, so inspect and restore it by hand`,
      });
    }
    rows.push({ gateId, sha: baseline.head, gatesConfigDigest: digest, passed: result.status === 0, exitCode: result.status });
  }
  return { suite: { source: "preflight-run", rows }, unavailable: null, reused: null, reusedFrom: null, baseline, runs: Object.freeze(runs) };
}

/**
 * Reuses the first landed attempt that measured every gate at the base, then
 * the first earlier preflight record whose rows are the passing suite at the
 * base; otherwise runs the suite. A reused record's rows keep their own source.
 */
export async function gatherSuite(
  landed: readonly LandedMeasurement[],
  earlier: readonly PreflightMeasurement[],
  request: BaselineSuiteRequest,
): Promise<SuiteGathering> {
  if (Object.keys(request.config.gates).length === 0) {
    return Object.freeze({ suite: null, unavailable: "no gate is configured", reused: null, reusedFrom: null, baseline: null, runs: [] });
  }
  for (const candidate of landed) {
    const rows = landedSuiteRows(candidate, request.baseSha, request.config);
    if (rows !== null) {
      return { suite: { source: "landed-attempt", rows: [...rows] }, unavailable: null, reused: candidate.label, reusedFrom: "landed-attempt", baseline: null, runs: [] };
    }
  }
  for (const candidate of earlier) {
    const rows = preflightSuiteRows(candidate, request.baseSha, request.config);
    const source = candidate.record.suite?.source;
    if (rows !== null && source !== undefined) {
      return { suite: { source, rows: [...rows] }, unavailable: null, reused: candidate.label, reusedFrom: "driver-preflight", baseline: null, runs: [] };
    }
  }
  return runBaselineSuite(request);
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// The ticket-body reader, split from plan-tickets.ts so the frontmatter path
// keeps its current cost and its stat-keyed cache: listing a backlog never
// pays for a body it does not show.
//
// Where a prompt begins is defined once, by invariant 12's fence
// (core/test/unit/meta/ticket-plan-sync.test.ts, `tickets()`): the file splits
// on its frontmatter block, the body splits on "## Build prompt\n\n", exactly
// two pieces are required, and the prompt is everything after the heading with
// trailing newlines removed. This reader applies that same split rather than a
// second definition, so the fence and a shift can never disagree about which
// bytes are a ticket's prompt.
//
// Why the digest covers the whole file and not the prompt block: a ticket's
// `## Handoff` sits above its prompt and is where a predecessor records what
// changed underneath it. A prompt-only digest would let a resume run against a
// ticket whose handoff moved after the manifest was written, and the run would
// silently carry instructions the owner never selected. The frontmatter is in
// the same position: a flipped `state` or a new `depends_on` edge changes what
// the selection meant. So any byte of the file moving is a change the resume
// must notice and refuse on (INV-4), and only a whole-file digest sees all of
// them.

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const PROMPT_HEADING = "## Build prompt\n\n";
const FENCE_OPEN = "```\n";
const FENCE_CLOSE = "\n```";

export type PlanTicketBodyRefusal =
  | "E_PLAN_TICKET_NO_FRONTMATTER"
  | "E_PLAN_TICKET_NO_BUILD_PROMPT"
  | "E_PLAN_TICKET_MULTIPLE_BUILD_PROMPTS"
  | "E_PLAN_TICKET_PROMPT_NOT_FENCED";

export class PlanTicketBodyError extends Error {
  readonly code: PlanTicketBodyRefusal;
  constructor(code: PlanTicketBodyRefusal, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "PlanTicketBodyError";
    this.code = code;
  }
}

export interface PlanTicketBody {
  /** The fence's prompt: byte-identical to the ticket's build-prompts § Section B block. */
  readonly prompt: string;
  /** The same block without its opening and closing fence lines. */
  readonly text: string;
}

export interface PlanTicketFile {
  /** sha256 hex over every byte of the file. */
  readonly digest: string;
  readonly body: PlanTicketBody;
}

/** sha256 hex over a ticket file's raw bytes. */
export function ticketFileDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Extracts the single `## Build prompt` fenced block, refusing zero, many, or an unfenced one. */
export function parsePlanTicketBody(source: string, label = "ticket"): PlanTicketBody {
  const match = FRONTMATTER.exec(source);
  if (match === null) {
    throw new PlanTicketBodyError("E_PLAN_TICKET_NO_FRONTMATTER", `${label} has no frontmatter block`);
  }
  const split = (match[2] ?? "").split(PROMPT_HEADING);
  if (split.length < 2) {
    throw new PlanTicketBodyError("E_PLAN_TICKET_NO_BUILD_PROMPT", `${label} has no "## Build prompt" section`);
  }
  if (split.length > 2) {
    throw new PlanTicketBodyError(
      "E_PLAN_TICKET_MULTIPLE_BUILD_PROMPTS",
      `${label} has ${split.length - 1} "## Build prompt" sections`,
    );
  }
  const prompt = (split[1] ?? "").replace(/\n+$/, "");
  if (!prompt.startsWith(FENCE_OPEN) || !prompt.endsWith(FENCE_CLOSE) || prompt.length < FENCE_OPEN.length + FENCE_CLOSE.length) {
    throw new PlanTicketBodyError("E_PLAN_TICKET_PROMPT_NOT_FENCED", `${label}'s build prompt is not one fenced block`);
  }
  return Object.freeze({ prompt, text: prompt.slice(FENCE_OPEN.length, prompt.length - FENCE_CLOSE.length) });
}

/** Reads one ticket file's bytes once: the digest and the prompt come from the same read. */
export async function readPlanTicketFile(path: string): Promise<PlanTicketFile> {
  const bytes = await readFile(path);
  return Object.freeze({
    digest: ticketFileDigest(bytes),
    body: parsePlanTicketBody(bytes.toString("utf8"), path),
  });
}

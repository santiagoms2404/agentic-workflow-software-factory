import { resolve } from "node:path";
import { apply, capture, hash, proposalHash, readInput, reference, replay, safe, type Location, type WriteOptions } from "../../planning/store.ts";
import { propose } from "../../planning/store.ts";
import { narrativeValue, proposalValue, referenceValue, NarrativeSchema, ProposalSchema } from "../../planning/schema.ts";
import { identifier } from "../../planning/model.ts";
import { checklist } from "../../planning/evidence.ts";
import { bounded, packet, previewGroup } from "../../planning/views.ts";
import { processOwnerTerminal, type OwnerTerminal } from "../tty.ts";

const HELP = `awsf group <operation> [options]
Planning only. No providers, attempt writes, lifecycle actions, or editable checklists.
All group operations use --project SLUG --group ID and the existing --state-root PATH.
  capture    --id EVENT --expected REV --input-id ID --input-file FILE --provenance TEXT --narrative-file JSON [--attachments-file JSON]
  inspect    [--proposal ID | --input-id ID] [--max-bytes N]
             Replay history or inspect one retained proposal/input without a whole-group read.
  input      --input-id ID  Emit original UTF-8 bytes without a trailing newline.
  propose    --id EVENT --expected REV --proposal-file JSON
  apply      --id EVENT --expected REV --proposal ID --proposal-hash SHA256 --reason TEXT
             Owner terminal confirmation of this exact planning change. No lifecycle permission.
  orient     [--proposal ID] [--max-bytes N]  Default 8192 bytes, explicit refusal on overflow.
  focus      --unit ID [--proposal ID] [--max-bytes N]  Default 16384 bytes.
             --proposal is an explicitly unapproved preview, never accepted scope.
  checklist  [--max-bytes N]  Read-only evidence, with as-of and group revision.
  reference  --file FILE --repository ID --revision REV --locator TEXT --kind text|attachment
  schema     --kind proposal|narrative  Strict JSON schemas, loaded on demand.
  help
Writes use stable idempotency keys and exact group revisions. A proposal appends a
stage, so applying it expects its base + 1. Any intervening stage requires a new
proposal. Hashes detect changes, not who authored a file. Runtime state stays out
of Git. Interrupted appends and abandoned locks fail closed and retain evidence.
`;
const OPTIONS: Record<string, string[]> = {
  capture: ["id", "expected", "input-id", "input-file", "provenance", "narrative-file", "attachments-file"],
  inspect: ["proposal", "input-id", "max-bytes"], input: ["input-id"], propose: ["id", "expected", "proposal-file"],
  apply: ["id", "expected", "proposal", "proposal-hash", "reason"],
  orient: ["proposal", "max-bytes"], focus: ["unit", "proposal", "max-bytes"], checklist: ["max-bytes"],
  reference: ["file", "repository", "revision", "locator", "kind"], schema: ["kind"], help: [],
};
function argsOf(args: readonly string[]): { operation: string; flags: Record<string, string> } {
  const operation = args[0] ?? "help";
  const allowed = OPTIONS[operation];
  if (!allowed) throw new Error("unknown group operation: use awsf group help");
  const flags: Record<string, string> = {};
  for (let index = 1; index < args.length; index++) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) throw new Error("unexpected positional group argument");
    const equals = argument.indexOf("=");
    const key = argument.slice(2, equals < 0 ? undefined : equals);
    if (![...allowed, "state-root", "project", "group"].includes(key)) throw new Error(`unknown group option --${key}`);
    if (Object.hasOwn(flags, key)) throw new Error(`duplicate group option --${key}`);
    const value = equals < 0 ? args[++index] : argument.slice(equals + 1);
    if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
    flags[key] = value;
  }
  return { operation, flags };
}
export interface GroupCommandOptions {
  args: readonly string[];
  stateRoot: string;
  cwd: string;
  terminal?: OwnerTerminal;
  now?: () => string;
}
export async function groupCommand(options: GroupCommandOptions): Promise<string> {
  const { operation, flags } = argsOf(options.args);
  const required = (key: string): string => {
    const value = flags[key];
    if (value === undefined) throw new Error(`group ${operation} requires --${key}`);
    return value;
  };
  const integer = (value: string): number => {
    if (!/^(0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("expected a nonnegative safe integer");
    return Number(value);
  };
  const jsonFile = async (key: string): Promise<unknown> => JSON.parse(await readInput(resolve(options.cwd, required(key)))) as unknown;
  if (operation === "help") return HELP;
  if (operation === "schema") {
    const kind = required("kind");
    if (kind !== "proposal" && kind !== "narrative") throw new Error("schema kind must be proposal or narrative");
    return bounded(kind === "proposal" ? ProposalSchema : NarrativeSchema, 1_048_576);
  }
  if (operation === "reference") {
    const kind = required("kind");
    if (kind !== "text" && kind !== "attachment") throw new Error("reference kind must be text or attachment");
    return bounded(await reference(resolve(options.cwd, required("file")), required("repository"), required("revision"), required("locator"), kind), 65_536);
  }
  const location: Location = { stateRoot: options.stateRoot, project: identifier(required("project")), group: identifier(required("group")) };
  if (["capture", "propose", "apply"].includes(operation)) {
    const write: WriteOptions = { ...location, id: identifier(required("id")), expected: integer(required("expected")) };
    let result;
    if (operation === "capture") {
      const text = await readInput(resolve(options.cwd, required("input-file")));
      const attachments = flags["attachments-file"] === undefined ? [] : await jsonFile("attachments-file");
      if (!Array.isArray(attachments)) throw new Error("attachments must be an array");
      result = await capture(write, { id: identifier(required("input-id")), text, sha256: hash(text), provenance: required("provenance"), attachments: attachments.map(referenceValue) }, narrativeValue(await jsonFile("narrative-file")));
    } else if (operation === "propose") {
      const proposal = proposalValue(await jsonFile("proposal-file"));
      result = await propose(write, proposal);
    } else {
      result = await apply(write, required("proposal"), required("proposal-hash"), required("reason"), options.terminal ?? processOwnerTerminal());
    }
    const proposed = operation === "propose" ? result.proposals.find((value) => value.id === result.stages.find((stage) => stage.id === write.id)?.proposal) : undefined;
    return bounded({ group: result.id, revision: result.revision, head: result.head, stages: result.stages.length,
      event: write.id, eventRevision: result.stages.findIndex((stage) => stage.id === write.id) + 1,
      authority: result.stages.find((stage) => stage.id === write.id)?.authority, ...(proposed ? { proposal: proposed.id, proposalHash: proposalHash(proposed) } : {}) }, 8192);
  }
  const { group } = await replay(location);
  if (group.revision === 0) throw new Error("group not found: capture the original input first");
  if (operation === "input") {
    const input = group.inputs.find((value) => value.id === required("input-id"));
    if (!input) throw new Error("input not found");
    return input.text;
  }
  const maxBytes = integer(flags["max-bytes"] ?? (operation === "orient" ? "8192" : operation === "focus" ? "16384" : "1048576"));
  if (operation === "inspect") {
    if (flags.proposal && flags["input-id"]) throw new Error("select one proposal or input, not both");
    if (flags.proposal) {
      const proposal = group.proposals.find((value) => value.id === flags.proposal);
      if (!proposal) throw new Error("proposal not found");
      return bounded({ group: group.id, revision: group.revision, head: group.head, proposal,
        hash: proposalHash(proposal), authority: group.decisions.includes(proposal.id) ? "owner-decision" : "assistant-proposal" }, maxBytes);
    }
    if (flags["input-id"]) {
      const input = group.inputs.find((value) => value.id === flags["input-id"]);
      if (!input) throw new Error("input not found");
      return bounded(input, maxBytes);
    }
    return bounded(group, maxBytes);
  }
  const preview = flags.proposal ?? null;
  const scope = preview === null ? group : previewGroup(group, preview);
  const observation = await checklist(scope, options.stateRoot, (options.now ?? (() => new Date().toISOString()))());
  const result = operation === "checklist" ? bounded(observation, maxBytes) : await packet(scope, observation, operation === "focus" ? required("unit") : null, maxBytes, preview);
  if ((await replay(location)).group.head !== group.head) throw new Error("group changed during projection: retry the read");
  safe(result);
  return result;
}

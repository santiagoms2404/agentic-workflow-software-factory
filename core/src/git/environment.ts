// Host Git inherits ordinary operating settings, not a caller-selected Git
// directory, object view, config override, index, or commit identity.
const REDIRECTS = new Set([
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_IMPLICIT_WORK_TREE",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH",
  "GIT_NAMESPACE", "GIT_REPLACE_REF_BASE", "GIT_NO_REPLACE_OBJECTS", "GIT_GRAFT_FILE", "GIT_SHALLOW_FILE",
  "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_CONFIG",
]);

export const HOST_AUTHOR = "Santiago Marin <santiagomarinsuarez@me.com>";

function splitHostAuthor(): { readonly name: string; readonly email: string } {
  const match = /^(.+) <([^<>]+)>$/u.exec(HOST_AUTHOR);
  if (match === null) throw new Error(`host author ${JSON.stringify(HOST_AUTHOR)} is not "name <email>"`);
  return Object.freeze({ name: match[1]!, email: match[2]! });
}

export const HOST_IDENTITY = splitHostAuthor();

/** Pin all four names and addresses; environment values outrank Git config. */
export function hostIdentityEnv(): Readonly<Record<string, string>> {
  return Object.freeze({
    GIT_AUTHOR_NAME: HOST_IDENTITY.name, GIT_AUTHOR_EMAIL: HOST_IDENTITY.email,
    GIT_COMMITTER_NAME: HOST_IDENTITY.name, GIT_COMMITTER_EMAIL: HOST_IDENTITY.email,
  });
}

interface GitEnvironmentOptions {
  /** An operation-owned private index, never inherited. */
  readonly indexFile?: string;
  readonly noOptionalLocks?: boolean;
  readonly asHost?: boolean;
  /** An explicit integration commit date for byte-for-byte replay. */
  readonly date?: string;
}

export function buildGitEnvironment(
  options: GitEnvironmentOptions = {},
  inherited: Readonly<NodeJS.ProcessEnv> = process.env,
): Record<string, string> {
  const env = Object.fromEntries(Object.entries(inherited).filter((entry): entry is [string, string] => {
    const key = entry[0].toUpperCase();
    return entry[1] !== undefined && !REDIRECTS.has(key) &&
      !key.startsWith("GIT_AUTHOR_") && !key.startsWith("GIT_COMMITTER_") &&
      !(key.startsWith("GIT_CONFIG_") && key !== "GIT_CONFIG_NOSYSTEM") &&
      key !== "GIT_TERMINAL_PROMPT" && (options.noOptionalLocks !== true || key !== "GIT_OPTIONAL_LOCKS");
  }));
  // The broker captures stdio; a prompt cannot reach the operator.
  env.GIT_TERMINAL_PROMPT = "0";
  if (options.noOptionalLocks === true) env.GIT_OPTIONAL_LOCKS = "0";
  if (options.indexFile !== undefined) env.GIT_INDEX_FILE = options.indexFile;
  if (options.asHost === true) {
    Object.assign(env, hostIdentityEnv());
    if (options.date !== undefined) env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = options.date;
  }
  return env;
}

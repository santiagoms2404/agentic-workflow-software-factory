import { test } from "node:test";
import assert from "node:assert/strict";
import {
  credentialKey,
  scrubCredentials,
  REDACTED_VALUE,
} from "../../../src/policy/redaction.ts";
import {
  containsCredential,
  scrubCredentialString,
} from "../../../../dashboard/shared/credential-patterns.ts";
import {
  classifyRisk,
  admitRisk,
  type RiskPolicy,
} from "../../../src/policy/risk.ts";
import {
  assertSandboxRoots,
  grantSandbox,
  PermissionSession,
  WorktreeConfinementUnavailable,
} from "../../../src/policy/sandbox-broker.ts";
import {
  evaluatePathPolicy,
  PermissionBreach,
} from "../../../src/policy/path-policy.ts";
import type { GitRunner } from "../../../src/git/changes.ts";
import type { ProcessSpec } from "../../../src/adapters/interface.ts";

function mockGitRunner(outputs: Record<string, string[]>): GitRunner {
  return (argv) => {
    const key = argv.join(" ");
    const stdout = outputs[key]?.shift();
    if (stdout === undefined) throw new Error(`unexpected git command: ${key}`);
    return { status: 0, stdout, stderr: "", error: null };
  };
}

const BASE_ROOTS = {
  canonicalRepository: "/srv/repos/project",
  worktree: "/srv/awsf-worktrees/attempt-1",
  sessionRuntime: "/srv/awsf-state/sessions/s1/attempts/1",
  stateRoot: "/srv/awsf-state",
};

const DUMMY_SPEC: ProcessSpec = {
  executable: "echo",
  argv: ["test"],
  cwd: BASE_ROOTS.worktree,
  env: { PATH: "/bin" },
  stdin: "",
  shell: false,
};

test("B10-13: redaction key matcher handles case-insensitive and partial credential key patterns", () => {
  const credentialKeys = [
    "client_secret",
    "clientSecret",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "my_api_key",
    "secret_key",
    "secretKey",
    "private_key",
    "privateKey",
    "access_token",
    "accessToken",
    "auth_token",
    "authToken",
    "refresh_token",
    "session_token",
    "token",
    "github_token",
    "password",
    "passwd",
    "passphrase",
    "authorization",
  ];
  for (const key of credentialKeys) {
    assert.equal(credentialKey(key), true, `expected ${key} to match credentialKey`);
  }

  const nonCredentialKeys = [
    "tokens",
    "promptTokens",
    "completionTokens",
    "totalTokens",
    "costAuthority",
    "usageAuthority",
    "author",
    "authoredAt",
    "safeField",
  ];
  for (const key of nonCredentialKeys) {
    assert.equal(credentialKey(key), false, `expected ${key} not to match credentialKey`);
  }

  const input = {
    client_secret: "arbitrary-unshaped-secret-value",
    OPENAI_API_KEY: "plain-text-key",
    nested: {
      authToken: "unshaped-token",
      tokens: 450,
      costAuthority: "provider",
      author: "operator",
    },
  };
  const scrubbed = scrubCredentials(input);
  assert.equal(scrubbed.client_secret, REDACTED_VALUE);
  assert.equal(scrubbed.OPENAI_API_KEY, REDACTED_VALUE);
  assert.equal(scrubbed.nested.authToken, REDACTED_VALUE);
  assert.equal(scrubbed.nested.tokens, 450);
  assert.equal(scrubbed.nested.costAuthority, "provider");
  assert.equal(scrubbed.nested.author, "operator");
});

test("B10-14: classifyRisk and admitRisk handle invalid paths gracefully without throwing", () => {
  const policy: RiskPolicy = {
    default: "T0",
    paths: {
      "src/sensitive/**": "T2",
      "src/feature/**": "T1",
    },
  };

  const invalidInputs = [
    "core/./src/state/x.ts",
    "../escaping/repo.ts",
    "invalid\\backslash\\path.ts",
    "control\nchar.ts",
    "",
  ];

  const mixedPaths = [
    ...invalidInputs,
    "src/feature/component.ts",
  ];

  let classification!: ReturnType<typeof classifyRisk>;
  assert.doesNotThrow(() => {
    classification = classifyRisk(mixedPaths, policy);
  });

  assert.equal(classification.classifiedTier, "T1");
  assert.ok(classification.invalidPaths !== undefined);
  assert.equal(classification.invalidPaths.length, 5);
  for (const inv of invalidInputs) {
    assert.ok(classification.invalidPaths.includes(inv));
  }

  const admission = admitRisk(mixedPaths, 1, policy);
  assert.equal(admission.sufficient, false, "admission must be insufficient when invalid paths are present");

  const validOnly = ["src/feature/component.ts"];
  const validAdmission = admitRisk(validOnly, 1, policy);
  assert.equal(validAdmission.sufficient, true);
});

test("B10-15 & B10-27: stateRoot and runtime disjointness checks are bidirectional", () => {
  assert.throws(
    () => assertSandboxRoots({
      ...BASE_ROOTS,
      stateRoot: "/srv/repos/project/nested-state",
    }),
    /state root and canonical repository must be disjoint/,
  );

  assert.throws(
    () => assertSandboxRoots({
      ...BASE_ROOTS,
      canonicalRepository: "/srv/awsf-state/nested-repo",
    }),
    /state root and canonical repository must be disjoint/,
  );

  assert.throws(
    () => assertSandboxRoots({
      ...BASE_ROOTS,
      stateRoot: "/srv/awsf-worktrees/attempt-1/nested-state",
    }),
    /state root and managed worktree must be disjoint/,
  );

  assert.throws(
    () => assertSandboxRoots({
      ...BASE_ROOTS,
      worktree: "/srv/awsf-state/nested-worktree",
    }),
    /state root and managed worktree must be disjoint/,
  );

  assert.throws(
    () => assertSandboxRoots({
      ...BASE_ROOTS,
      sessionRuntime: "/srv/separate-runtime",
      stateRoot: "/srv/separate-runtime/nested-state",
    }),
    /state root may not reside inside session runtime/,
  );

  assert.throws(
    () => assertSandboxRoots({
      ...BASE_ROOTS,
      sessionRuntime: "/srv/repos/project/nested-runtime",
    }),
    /session runtime may not make part of the canonical repository writable/,
  );

  assert.throws(
    () => assertSandboxRoots({
      ...BASE_ROOTS,
      sessionRuntime: "/srv/shared-root",
      canonicalRepository: "/srv/shared-root/canonical-repo",
    }),
    /session runtime may not make part of the canonical repository writable/,
  );

  assert.throws(
    () => assertSandboxRoots({
      ...BASE_ROOTS,
      sessionRuntime: "/srv/separate-runtime/attempt-1",
      providerWritableRoots: ["/srv/separate-runtime/attempt-1/provider-state"],
    }),
    /provider state root may not overlap the session runtime/,
  );
});

test("B10-16: Linux without bwrap falls back to tool-policy or refuses per sandbox policy", () => {
  const linuxNoBwrap = grantSandbox(
    DUMMY_SPEC,
    { ...BASE_ROOTS, writes: ["src/**"], platform: "linux" },
    () => false,
  );
  assert.equal(linuxNoBwrap.badge, "tool-policy");
  assert.equal(linuxNoBwrap.mechanism, "adapter-tool-policy");
  assert.equal(linuxNoBwrap.spec, DUMMY_SPEC);

  const darwin = grantSandbox(
    DUMMY_SPEC,
    { ...BASE_ROOTS, writes: ["src/**"], platform: "darwin" },
    () => true,
  );
  assert.equal(darwin.badge, "unavailable");
  assert.equal(darwin.mechanism, "none");

  assert.throws(
    () => grantSandbox(
      DUMMY_SPEC,
      { ...BASE_ROOTS, writes: ["src/**"], platform: "linux", confinement: "worktree" },
      () => false,
    ),
    WorktreeConfinementUnavailable,
  );
});

test("B10-17: enforce accounts for committed changes and deletions", () => {
  const git = mockGitRunner({
    "status --porcelain --untracked-files=all": [""],
    "diff HEAD --numstat --no-renames -z": [
      "",
      "",
    ],
    "ls-files --others --exclude-standard -z": [
      "",
      "",
      "",
    ],
    "rev-parse HEAD": ["head-commit-sha-1"],
    "diff --name-only --no-renames -z head-commit-sha-1 --": [
      ["AGENTS.md", "src/code.ts", ""].join("\0"),
    ],
  });

  const session = new PermissionSession({
    ...BASE_ROOTS,
    writes: ["src/**"],
    protectedPaths: ["AGENTS.md"],
    profile: "managed-worker",
    tools: ["read", "write"],
    platform: "linux",
    sandboxProbe: () => false,
    git,
  });

  assert.throws(
    () => session.enforce(),
    (error: unknown) => {
      assert.ok(error instanceof PermissionBreach);
      assert.deepEqual(error.offendingPaths, ["AGENTS.md"]);
      return true;
    },
  );
});

test("B10-17: enforce reports committed deletions when writes are allowed", () => {
  const git = mockGitRunner({
    "status --porcelain --untracked-files=all": [""],
    "diff HEAD --numstat --no-renames -z": [
      "",
      "",
    ],
    "ls-files --others --exclude-standard -z": [
      "",
      "",
      "",
    ],
    "rev-parse HEAD": ["head-commit-sha-1"],
    "diff --name-only --no-renames -z head-commit-sha-1 --": [
      ["src/deleted.ts", ""].join("\0"),
    ],
  });

  const session = new PermissionSession({
    ...BASE_ROOTS,
    writes: ["src/**"],
    protectedPaths: ["AGENTS.md"],
    profile: "managed-worker",
    tools: ["read", "write"],
    platform: "linux",
    sandboxProbe: () => false,
    git,
  });

  const result = session.enforce();
  assert.deepEqual(result.changedPaths, ["src/deleted.ts"]);
});

test("B10-26: URL credential regex avoids quadratic backtracking and scrubs only credentialed URLs", () => {
  const longRun = "deadbeef".repeat(5000);
  const start = performance.now();
  const matched = containsCredential(longRun);
  const duration = performance.now() - start;
  assert.equal(matched, false);
  assert.ok(duration < 200, `containsCredential took too long: ${String(duration)}ms`);

  const plainUrl = "https://example.com/api/v1/resource";
  assert.equal(containsCredential(plainUrl), false);
  assert.equal(scrubCredentialString(plainUrl), plainUrl);

  const credentialUrl = "https://admin:supersecret@example.com/api/v1/resource";
  assert.equal(containsCredential(credentialUrl), true);
  assert.equal(scrubCredentialString(credentialUrl), `${REDACTED_VALUE}example.com/api/v1/resource`);
});

test("B10-48: case sensitivity consistency for path policy and risk classification", () => {
  const violationsCaseInsensitive = evaluatePathPolicy(
    ["Core/Src/Config/x.ts"],
    {
      writes: ["**"],
      protectedPaths: ["core/src/config/**"],
      caseSensitive: false,
    },
  );
  assert.equal(violationsCaseInsensitive.length, 1);
  assert.equal(violationsCaseInsensitive[0]!.reasons.includes("protected-path"), true);

  const violationsCaseSensitive = evaluatePathPolicy(
    ["Core/Src/Config/x.ts"],
    {
      writes: ["**"],
      protectedPaths: ["core/src/config/**"],
      caseSensitive: true,
    },
  );
  assert.equal(violationsCaseSensitive.length, 0);

  const riskPolicyCaseInsensitive: RiskPolicy = {
    default: "T0",
    paths: {
      "migrations/**": "T2",
    },
    caseSensitive: false,
  };
  assert.equal(classifyRisk(["Migrations/0001.sql"], riskPolicyCaseInsensitive).classifiedTier, "T2");

  const riskPolicyCaseSensitive: RiskPolicy = {
    default: "T0",
    paths: {
      "migrations/**": "T2",
    },
    caseSensitive: true,
  };
  assert.equal(classifyRisk(["Migrations/0001.sql"], riskPolicyCaseSensitive).classifiedTier, "T0");
});

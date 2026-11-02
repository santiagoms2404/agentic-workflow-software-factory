import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configuredInteractiveTimeout } from "../../../src/cli/commands/quota.ts";
import { gatherDoctorRows } from "../../../src/doctor/gather.ts";
import { DEFAULT_QUOTA_PROBE_TIMEOUTS } from "../../../src/quota/probe.ts";

const baseConfigText = readFileSync(new URL("../../../../awsf.config.yaml", import.meta.url), "utf8");
const configWithQuotaStop = baseConfigText.replace(
  "routing:",
  `routing:
  quota_stop:
    default:
      minutes: 15
      probe_timeout_ms: 2500`,
);

test("B2-09: configuredInteractiveTimeout maintains 8000ms default when boundary probe_timeout_ms is shorter", () => {
  const routes = [{ adapterId: "claude" }];
  const quotaStop = {
    default: {
      minutes: 15,
      probe_timeout_ms: 2500,
    },
  };

  const timeout = configuredInteractiveTimeout(routes, quotaStop);
  assert.equal(
    timeout,
    DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs,
    "interactive preflight timeout must maintain 8000ms default, not clamp to 2500ms boundary timeout",
  );
});

test("B2-09: gatherDoctorRows maintains 8000ms interactive preflight timeout when quota_stop has short probe_timeout_ms", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-b2-09-doctor-"));
  try {
    writeFileSync(join(root, "awsf.config.yaml"), configWithQuotaStop);
    const gitRoot = join(root, "git-common");
    mkdirSync(gitRoot);
    writeFileSync(join(gitRoot, "HEAD"), "synthetic head");
    writeFileSync(join(gitRoot, "config"), "synthetic config");
    const stateRoot = join(root, "state");

    const observedTimeouts: number[] = [];
    await gatherDoctorRows({
      cwd: root,
      stateRoot,
      env: { PATH: "/synthetic/bin" },
      resolveExecutable: (executable) => `/synthetic/bin/${executable}`,
      runCommand: (executable, argv, options) => {
        if (executable.endsWith("/git")) {
          return { status: 0, error: null, stderr: "", stdout: argv.includes("--git-common-dir") ? gitRoot : root };
        }
        if (executable.endsWith("/bwrap")) {
          observedTimeouts.push(options.timeoutMs);
          return {
            status: 0,
            error: null,
            stderr: "",
            stdout: argv.includes("--version") ? "0.1.29" : JSON.stringify({ providers: [] }),
          };
        }
        return { status: 0, error: null, stderr: "", stdout: "" };
      },
    });

    assert.ok(observedTimeouts.length > 0, "quota probe must run via bwrap");
    for (const timeout of observedTimeouts) {
      assert.equal(
        timeout,
        DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs,
        "gatherDoctorRows quota probe must maintain 8000ms interactive timeout",
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("B2-09 triangulation: configuredInteractiveTimeout handles undefined quotaStop, larger timeouts, and per-adapter overrides", () => {
  const routes = [{ adapterId: "claude" }];

  // 1. undefined quotaStop defaults to 8000ms
  assert.equal(
    configuredInteractiveTimeout(routes, undefined),
    DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs,
  );

  // 2. empty routes with 2500ms default maintains 8000ms
  assert.equal(
    configuredInteractiveTimeout([], { default: { minutes: 15, probe_timeout_ms: 2500 } }),
    DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs,
  );

  // 3. per-adapter override shorter than 8000ms maintains 8000ms
  assert.equal(
    configuredInteractiveTimeout(routes, {
      default: { minutes: 15, probe_timeout_ms: 2500 },
      by_adapter: { claude: { minutes: 10, probe_timeout_ms: 1000 } },
    }),
    DEFAULT_QUOTA_PROBE_TIMEOUTS.interactivePreflightMs,
  );

  // 4. configured timeout larger than 8000ms is respected (not clamped down to 8000ms)
  assert.equal(
    configuredInteractiveTimeout(routes, {
      default: { minutes: 15, probe_timeout_ms: 12000 },
    }),
    12000,
  );

  // 5. per-adapter override larger than 8000ms is respected
  assert.equal(
    configuredInteractiveTimeout(routes, {
      default: { minutes: 15, probe_timeout_ms: 2500 },
      by_adapter: { claude: { minutes: 10, probe_timeout_ms: 15000 } },
    }),
    15000,
  );
});

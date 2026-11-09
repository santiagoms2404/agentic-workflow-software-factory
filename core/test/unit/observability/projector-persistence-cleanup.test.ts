import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { SyntheticAttempt, phase, session, usage } from "../_metrics-journal.ts";

function routeFixture(provider: string, requestedModel: string, resolvedModel: string): SyntheticAttempt {
  const run = new SyntheticAttempt(session("projection-cleanup"));
  run.phase(phase("build", "builder"));
  run.start("phase-build", "builder", "codex", provider, requestedModel);
  run.call("phase-build", "builder", "codex", provider, requestedModel, resolvedModel, usage(10, 2, 0, 0, null));
  return run;
}

test("attempt projection creates its session row only when it is absent", () => {
  const database = openDatabase(":memory:");
  let sessionInserts = 0;
  const counted = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          if (sql.includes("INSERT OR IGNORE INTO sessions")) sessionInserts += 1;
          return target.prepare(sql);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    routeFixture("openai-codex", "codex:model", "model-2026").project(counted as typeof database);
    assert.equal(sessionInserts, 1, "later status records do not re-scrub immutable session fields");
  } finally {
    database.close();
  }
});

test("call records and launch records apply the same credential scrub to route columns", () => {
  const database = openDatabase(":memory:");
  const shaped = "gh" + "p_" + "a".repeat(36);
  try {
    routeFixture(shaped, shaped, shaped).project(database);
    const row = database.prepare(`SELECT worker_provider, worker_model_requested, worker_model_resolved
      FROM sessions WHERE session_id = ?`).get("projection-cleanup") as {
        worker_provider: string;
        worker_model_requested: string;
        worker_model_resolved: string | null;
      };
    assert.deepEqual({ ...row }, {
      worker_provider: "[REDACTED]",
      worker_model_requested: "[REDACTED]",
      worker_model_resolved: null,
    });
    const agent = database.prepare(`SELECT provider, requested_model, resolved_model FROM agent_sessions
      WHERE session_id = ? AND agent = 'builder'`).get("projection-cleanup") as {
        provider: string;
        requested_model: string;
        resolved_model: string;
      };
    assert.deepEqual({ ...agent }, {
      provider: "[REDACTED]",
      requested_model: "[REDACTED]",
      resolved_model: "[REDACTED]",
    });
  } finally {
    database.close();
  }
});

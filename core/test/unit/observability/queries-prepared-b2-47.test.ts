import assert from "node:assert/strict";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import {
  agentsForSession,
  compactActivityForSession,
  phasesForSession,
  replayPayloadsForSession,
} from "../../../src/observability/queries.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";

test("session-card read statements are prepared once per database and reused across rows", () => {
  const database = openDatabase(":memory:");
  let prepared = 0;
  const counted = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (...args: Parameters<DatabaseSync["prepare"]>) => {
          prepared += 1;
          return target.prepare(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DatabaseSync;

  try {
    for (let row = 0; row < 20; row += 1) {
      phasesForSession(counted, `session-${row}`);
      replayPayloadsForSession(counted, `session-${row}`);
      agentsForSession(counted, `session-${row}`);
      compactActivityForSession(counted, `session-${row}`);
    }
    assert.equal(prepared, 4);
  } finally {
    database.close();
  }
});

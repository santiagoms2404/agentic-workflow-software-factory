import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "../../src/persistence/journal.ts";
import { resolvePhaseRoute } from "../../src/observability/phase-route.ts";
import { rebuildDatabase } from "../../src/observability/rebuild.ts";
import { openDatabase, type DatabaseSync } from "../../src/observability/sqlite.ts";
import type { AttemptStatusProjection } from "../../src/observability/projector.ts";
import { readPhaseFacts } from "../../src/metrics/phase-facts.ts";
import { OPUS_HIGH, SNAPSHOT, SyntheticAttempt, phase, session, usage } from "./_metrics-journal.ts";

const T01_BUILD = { key: "t01-build", owner: "builder" };

function routeColumns(db: DatabaseSync, phaseId: string): Record<string, unknown> {
  return { ...db.prepare(`SELECT route_adapter, route_provider, route_model, route_effort, effort_source
    FROM phases WHERE phase_id = ?`).get(phaseId) as object };
}

// ---------------------------------------------------------------------------
// resolvePhaseRoute: one fixture per effort source
// ---------------------------------------------------------------------------

test("journal: the route event's effective block wins over the snapshot and keeps its effort source", () => {
  assert.deepEqual(resolvePhaseRoute({ phase: { key: "shift-review", owner: "reviewer" }, routeEvent: OPUS_HIGH, configSnapshot: SNAPSHOT }), {
    adapterId: "claude",
    adapterKind: "claude-code",
    provider: "anthropic",
    model: "opus",
    effort: "high",
    effortSource: "journal",
    journalSource: "attempt-override",
  });
});

test("config-phase-route: a phase-route entry under the phase key supplies the effort", () => {
  const snapshot = { ...SNAPSHOT, routing: { ...SNAPSHOT.routing, phase_routes: { builder: { adapter: "claude", model: "claude:opus", effort: "max" } } } };
  assert.deepEqual(resolvePhaseRoute({ phase: { key: "builder", owner: "builder" }, routeEvent: null, configSnapshot: snapshot }), {
    adapterId: "claude",
    adapterKind: "claude-code",
    // The committed Claude adapter declares no provider, and none is inferred.
    provider: null,
    model: "claude:opus",
    effort: "max",
    effortSource: "config-phase-route",
    journalSource: null,
  });
});

test("config-phase-route: a compiled phase resolves through its owner's entry, and an exact key still wins", () => {
  const byRole = { ...SNAPSHOT, routing: { ...SNAPSHOT.routing, phase_routes: { builder: { effort: "medium" } } } };
  const viaRole = resolvePhaseRoute({ phase: T01_BUILD, routeEvent: null, configSnapshot: byRole });
  assert.equal(viaRole.effortSource, "config-phase-route");
  assert.equal(viaRole.effort, "medium");
  assert.equal(viaRole.model, "codex:gpt-6-sol", "fields the entry leaves out come from the owning agent");

  const exact = { ...SNAPSHOT, routing: { ...SNAPSHOT.routing, phase_routes: { builder: { effort: "medium" }, "t01-build": { effort: "low" } } } };
  assert.equal(resolvePhaseRoute({ phase: T01_BUILD, routeEvent: null, configSnapshot: exact }).effort, "low");
});

test("config-agent: a shift's t01-build resolves through its owner, builder", () => {
  assert.deepEqual(resolvePhaseRoute({ phase: T01_BUILD, routeEvent: null, configSnapshot: SNAPSHOT }), {
    adapterId: "codex",
    adapterKind: "pi-codex",
    provider: "openai-codex",
    model: "codex:gpt-6-sol",
    effort: "xhigh",
    effortSource: "config-agent",
    journalSource: null,
  });
});

test("config-agent: a phase route that names only a model leaves the effort to the agent", () => {
  const snapshot = { ...SNAPSHOT, routing: { ...SNAPSHOT.routing, phase_routes: { "t01-build": { model: "codex:gpt-5.6-sol" } } } };
  const resolved = resolvePhaseRoute({ phase: T01_BUILD, routeEvent: null, configSnapshot: snapshot });
  assert.equal(resolved.model, "codex:gpt-5.6-sol");
  assert.equal(resolved.effort, "xhigh");
  assert.equal(resolved.effortSource, "config-agent");
});

test("unknown: silent sources resolve to nothing rather than a guess", () => {
  const empty = { adapterId: null, adapterKind: null, provider: null, model: null, effort: null, effortSource: "unknown", journalSource: null };
  assert.deepEqual(resolvePhaseRoute({ phase: T01_BUILD, routeEvent: null, configSnapshot: {} }), empty);
  assert.deepEqual(resolvePhaseRoute({ phase: T01_BUILD, routeEvent: null, configSnapshot: null }), empty);
  assert.deepEqual(resolvePhaseRoute({ phase: { key: "planner", owner: "planner" }, routeEvent: null, configSnapshot: SNAPSHOT }), empty);
  // A shipped phase key never borrows another role's entry.
  const snapshot = { ...SNAPSHOT, routing: { ...SNAPSHOT.routing, phase_routes: { builder: { effort: "low" } } } };
  assert.equal(resolvePhaseRoute({ phase: { key: "planner", owner: "planner" }, routeEvent: null, configSnapshot: snapshot }).effortSource, "unknown");
  // An effort outside the vocabulary is not an effort.
  const odd = { ...SNAPSHOT, agents: [{ ...SNAPSHOT.agents[0]!, thinking: "extreme" }] };
  const resolved = resolvePhaseRoute({ phase: T01_BUILD, routeEvent: null, configSnapshot: odd });
  assert.equal(resolved.effort, null);
  assert.equal(resolved.effortSource, "unknown");
});

test("a route event without a whole effective block does not count as journal evidence", () => {
  const broken = { ...OPUS_HIGH, effective: { ...OPUS_HIGH.effective, effort: "extreme" } } as unknown as typeof OPUS_HIGH;
  assert.equal(resolvePhaseRoute({ phase: T01_BUILD, routeEvent: broken, configSnapshot: SNAPSHOT }).effortSource, "config-agent");
});

// ---------------------------------------------------------------------------
// The projector fills migration 0007's columns
// ---------------------------------------------------------------------------

test("the projector fills a phase from the snapshot, then the launch's route event replaces it", () => {
  const db = openDatabase(":memory:");
  try {
    const run = new SyntheticAttempt(session("s1"));
    run.phase(phase("shift-review", "reviewer"));
    run.project(db);
    assert.deepEqual(routeColumns(db, "phase-shift-review"), {
      route_adapter: "claude", route_provider: null, route_model: "claude:opus", route_effort: "high", effort_source: "config-agent",
    });

    const more = new SyntheticAttempt(session("s1"));
    more.records.push(...run.records);
    more.start("phase-shift-review", "reviewer", "claude", "anthropic", "claude:opus", { ...OPUS_HIGH, effective: { ...OPUS_HIGH.effective, effort: "max" } });
    // A later phase record carries no route. It must not demote the journal's.
    more.phase(phase("shift-review", "reviewer", { status: "SUCCEEDED", endedAt: "2026-09-26T10:05:00.000Z" }));
    more.project(db);
    assert.deepEqual(routeColumns(db, "phase-shift-review"), {
      route_adapter: "claude", route_provider: "anthropic", route_model: "opus", route_effort: "max", effort_source: "journal",
    });
  } finally {
    db.close();
  }
});

test("a snapshot-derived value never replaces a journal-derived one, even when only the snapshot is readable", () => {
  const db = openDatabase(":memory:");
  try {
    const run = new SyntheticAttempt(session("s1"));
    run.phase(phase("shift-review", "reviewer"));
    run.start("phase-shift-review", "reviewer", "claude", "anthropic", "claude:opus", OPUS_HIGH);
    run.project(db);
    // Leave the next phase record nothing but the snapshot to resolve from:
    // the route event no longer names a whole route and the snapshot now
    // resolves differently. Only the guard keeps the journal's values.
    db.prepare("UPDATE events SET payload_json = '{}' WHERE type = 'route_resolution'").run();
    const changed = { ...SNAPSHOT, agents: [SNAPSHOT.agents[0]!, { ...SNAPSHOT.agents[1]!, thinking: "low" }] };
    db.prepare("UPDATE sessions SET config_snapshot_json = ? WHERE session_id = 's1'").run(JSON.stringify(changed));
    const again = new SyntheticAttempt(session("s1"));
    again.records.push(...run.records);
    again.phase(phase("shift-review", "reviewer", { status: "SUCCEEDED" }));
    again.project(db);
    assert.equal(routeColumns(db, "phase-shift-review")["effort_source"], "journal");
    assert.equal(routeColumns(db, "phase-shift-review")["route_effort"], "high");
  } finally {
    db.close();
  }
});

test("only agent phases carry a route; a host phase's columns stay NULL", () => {
  const db = openDatabase(":memory:");
  try {
    const run = new SyntheticAttempt(session("s1"));
    run.phase(phase("t01-tests", "host", { kind: "code" }));
    run.project(db);
    assert.deepEqual(routeColumns(db, "phase-t01-tests"), {
      route_adapter: null, route_provider: null, route_model: null, route_effort: null, effort_source: null,
    });
  } finally {
    db.close();
  }
});

test("a session whose snapshot is silent projects effort_source unknown, never a guess", () => {
  const db = openDatabase(":memory:");
  try {
    const run = new SyntheticAttempt(session("s1", {}));
    run.phase(phase("t01-build", "builder"));
    run.project(db);
    assert.deepEqual(routeColumns(db, "phase-t01-build"), {
      route_adapter: null, route_provider: null, route_model: null, route_effort: null, effort_source: "unknown",
    });
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// awsf db rebuild backfills from nothing, identically every time
// ---------------------------------------------------------------------------

function mixedJournal(): SyntheticAttempt {
  const run = new SyntheticAttempt(session("s1"));
  // Legacy: launched before route provenance existed, so no route event.
  run.phase(phase("t01-build", "builder", { ordinal: 1 }));
  run.start("phase-t01-build", "builder", "codex", "openai-codex", "codex:gpt-6-sol");
  run.event("phase-t01-build", "run-1", { kind: "run.started", adapter: "pi-codex", requestedModel: "gpt-6-sol" });
  run.event("phase-t01-build", "run-1", { kind: "usage", usage: usage(900, 40, 3000, 0, 10) });
  run.call("phase-t01-build", "builder", "codex", "openai-codex", "codex:gpt-6-sol", "gpt-6-sol", usage(900, 40, 3000, 0, 10));
  run.phase(phase("t01-build", "builder", { ordinal: 1, status: "SUCCEEDED", endedAt: "2026-09-26T10:12:00.000Z" }));
  // New: the launch journals its route.
  run.phase(phase("shift-review", "reviewer", { ordinal: 2 }));
  run.start("phase-shift-review", "reviewer", "claude", "anthropic", "claude:opus", OPUS_HIGH);
  run.event("phase-shift-review", "run-2", { kind: "run.started", adapter: "claude-code", requestedModel: "opus" });
  run.event("phase-shift-review", "run-2", { kind: "usage", usage: usage(50, 20, 500, 100, null) });
  run.call("phase-shift-review", "reviewer", "claude", "anthropic", "claude:opus", "claude-opus-5-5", usage(50, 20, 500, 100, null));
  run.phase(phase("shift-review", "reviewer", { ordinal: 2, status: "SUCCEEDED", endedAt: "2026-09-26T10:20:00.000Z" }));
  return run;
}

function snapshotOf(db: DatabaseSync): { columns: Record<string, unknown>[]; facts: unknown } {
  const columns = (db.prepare(`SELECT phase_id, route_adapter, route_provider, route_model, route_effort, effort_source
    FROM phases ORDER BY ordinal`).all() as object[]).map((row) => ({ ...row }));
  return { columns, facts: readPhaseFacts(db) };
}

test("awsf db rebuild from nothing fills a legacy phase from config and a new one from its journal, identically twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "awsf-metrics-rebuild-"));
  const journalPath = join(dir, "journal.jsonl");
  const targetPath = join(dir, "awsf.db");
  const journal = new Journal<AttemptStatusProjection>(journalPath);
  const run = mixedJournal();
  try {
    for (const record of run.records) await journal.append(record);
    await journal.close();
    const source = { session: { ...run.init, journalPath }, journalPath, attemptStatus: (record: { event: unknown }) => record.event as AttemptStatusProjection };

    const first = await rebuildDatabase({ targetPath, stamp: () => "first", sources: [source] });
    assert.equal(first.ok, true, first.ok ? undefined : first.reason);
    const rebuilt = openDatabase(targetPath, { readonly: true });
    let once: ReturnType<typeof snapshotOf>;
    try {
      once = snapshotOf(rebuilt);
    } finally {
      rebuilt.close();
    }
    assert.deepEqual(once.columns, [
      { phase_id: "phase-t01-build", route_adapter: "codex", route_provider: "openai-codex", route_model: "codex:gpt-6-sol", route_effort: "xhigh", effort_source: "config-agent" },
      { phase_id: "phase-shift-review", route_adapter: "claude", route_provider: "anthropic", route_model: "opus", route_effort: "high", effort_source: "journal" },
    ]);

    const second = await rebuildDatabase({ targetPath, stamp: () => "second", sources: [source] });
    assert.equal(second.ok, true, second.ok ? undefined : second.reason);
    const again = openDatabase(targetPath, { readonly: true });
    try {
      assert.deepEqual(snapshotOf(again), once);
    } finally {
      again.close();
    }

    // The live projection and the rebuilt one agree.
    const live = openDatabase(":memory:");
    try {
      run.project(live);
      assert.deepEqual(snapshotOf(live), once);
    } finally {
      live.close();
    }
  } finally {
    await journal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

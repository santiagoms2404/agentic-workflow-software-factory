PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA wal_autocheckpoint = 1000;

CREATE TABLE sessions (
  session_id             TEXT PRIMARY KEY,
  project_slug           TEXT NOT NULL,
  task_id                TEXT NOT NULL,
  attempt                INTEGER NOT NULL CHECK (attempt >= 1),
  workflow_id            TEXT NOT NULL,
  risk_tier              INTEGER NOT NULL CHECK (risk_tier IN (0,1,2)),
  is_protected           INTEGER NOT NULL CHECK (is_protected IN (0,1)),
  lifecycle_state        TEXT NOT NULL CHECK (lifecycle_state IN (
                           'DRAFT','PREPARED','RUNNING','GATING','REVIEWING',
                           'AWAITING_OWNER','LANDING','LANDED','BLOCKED','CANCELLED')),
  request_text           TEXT NOT NULL,
  base_sha               TEXT, head_sha TEXT, candidate_sha TEXT,
  worker_provider        TEXT, worker_model_requested TEXT, worker_model_resolved TEXT,
  review_provider        TEXT, review_verdict TEXT,
  call_ceiling           INTEGER NOT NULL,
  calls_reserved         INTEGER NOT NULL DEFAULT 0 CHECK (calls_reserved >= 0),
  calls_spent            INTEGER NOT NULL DEFAULT 0 CHECK (calls_spent >= 0),
  corrections_auto       INTEGER NOT NULL DEFAULT 0,
  corrections_owner      INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  reasoning_tokens INTEGER, total_tokens INTEGER,
  reasoning_relation     TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (reasoning_relation IN ('included-in-output','additive','unknown')),
  usage_authority        TEXT NOT NULL DEFAULT 'none'
                         CHECK (usage_authority IN ('provider','partial','none')),
  estimated_cost_usd     REAL,
  cost_authority         TEXT NOT NULL DEFAULT 'unavailable'
                         CHECK (cost_authority IN ('provider','catalog-estimate','unavailable')),
  cost_partial           INTEGER NOT NULL DEFAULT 0 CHECK (cost_partial IN (0,1)),
  observability_degraded INTEGER NOT NULL DEFAULT 0 CHECK (observability_degraded IN (0,1)),
  archived               INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  started_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT,
  state_revision         INTEGER NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
  last_projected_seq     INTEGER NOT NULL DEFAULT 0 CHECK (last_projected_seq >= 0),
  config_snapshot_json   TEXT NOT NULL CHECK (json_valid(config_snapshot_json)),
  journal_path           TEXT NOT NULL,
  UNIQUE (project_slug, task_id, attempt)
) STRICT;

-- The state machine's audit trail. SSSF has no equivalent because it has no state machine.
CREATE TABLE transitions (
  transition_id  TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  seq            INTEGER NOT NULL CHECK (seq >= 1),
  from_state     TEXT NOT NULL, to_state TEXT NOT NULL,
  actor          TEXT NOT NULL CHECK (actor IN ('host','owner','human')),
  edge_id        TEXT NOT NULL,                       -- 'L20'
  reason_source  TEXT NOT NULL, reason_code TEXT, reason_detail TEXT,
  spawn_site     INTEGER NOT NULL DEFAULT 0 CHECK (spawn_site IN (0,1)),
  at             TEXT NOT NULL,
  UNIQUE (session_id, seq)
) STRICT;

CREATE TABLE phases (
  phase_id       TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  ordinal        INTEGER NOT NULL CHECK (ordinal >= 1),
  phase_key TEXT NOT NULL, name TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('agent','code','engineer')),
  owner TEXT NOT NULL, description TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN (
                   'QUEUED','RUNNING','VALIDATING','CORRECTING',
                   'SUCCEEDED','FAILED','SKIPPED','CANCELLED')),
  correction_count INTEGER NOT NULL DEFAULT 0 CHECK (correction_count >= 0),
  max_corrections  INTEGER NOT NULL DEFAULT 0 CHECK (max_corrections >= 0),
  error_code TEXT, error_message TEXT,
  started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL,
  UNIQUE (session_id, ordinal)
) STRICT;

CREATE TABLE events (
  event_row         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          TEXT NOT NULL UNIQUE,
  session_id        TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  phase_id          TEXT REFERENCES phases(phase_id) ON DELETE RESTRICT,
  run_id TEXT, parent_event_id TEXT,
  first_source_seq  INTEGER NOT NULL CHECK (first_source_seq >= 1),
  last_source_seq   INTEGER NOT NULL CHECK (last_source_seq >= first_source_seq),
  type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT,
  payload_json      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  started_at TEXT NOT NULL, ended_at TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  reasoning_tokens INTEGER, total_tokens INTEGER,
  estimated_cost_usd REAL,
  cost_authority    TEXT CHECK (cost_authority IS NULL OR cost_authority IN
                      ('provider','catalog-estimate','unavailable')),
  redaction_level   TEXT NOT NULL DEFAULT 'public'
                    CHECK (redaction_level IN ('public','private-ref'))
) STRICT;

CREATE TABLE envelopes (
  envelope_id      TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  phase_id         TEXT NOT NULL REFERENCES phases(phase_id) ON DELETE RESTRICT,
  agent TEXT NOT NULL, schema_id TEXT NOT NULL,
  correction_round INTEGER NOT NULL CHECK (correction_round >= 0),
  valid            INTEGER NOT NULL CHECK (valid IN (0,1)),
  producer_status  TEXT CHECK (producer_status IS NULL OR producer_status IN ('success','failure')),
  payload_json     TEXT NOT NULL CHECK (json_valid(payload_json)),
  violations_json  TEXT NOT NULL CHECK (json_valid(violations_json)),
  file_path TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (phase_id, correction_round)
) STRICT;

CREATE TABLE gate_results (
  gate_result_id   TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  phase_id         TEXT NOT NULL REFERENCES phases(phase_id) ON DELETE RESTRICT,
  correction_round INTEGER NOT NULL CHECK (correction_round >= 0),
  gate_id          TEXT NOT NULL,
  gate_kind        TEXT NOT NULL CHECK (gate_kind IN ('pure','filesystem','git','subprocess','journey')),
  candidate_sha    TEXT,
  passed           INTEGER NOT NULL CHECK (passed IN (0,1)),
  command_json     TEXT CHECK (command_json IS NULL OR json_valid(command_json)),
  exit_code        INTEGER,
  checks_json      TEXT NOT NULL CHECK (json_valid(checks_json)),   -- WHAT it verified, pass or fail
  violations_json  TEXT NOT NULL CHECK (json_valid(violations_json)),
  output_path TEXT, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
  UNIQUE (phase_id, correction_round, gate_id)
) STRICT;

CREATE TABLE processes (
  process_id       TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  phase_id         TEXT REFERENCES phases(phase_id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL, adapter_id TEXT NOT NULL, role TEXT NOT NULL,
  transport        TEXT NOT NULL CHECK (transport IN ('process','http','fixture','composite')),
  pid INTEGER, pgid INTEGER,
  process_start_identity TEXT,                       -- so a recycled PID is never killed by mistake
  status           TEXT NOT NULL CHECK (status IN
                     ('RESERVED','REGISTERED','RUNNING','EXITED','FAILED','CANCELLED')),
  command_json     TEXT NOT NULL CHECK (json_valid(command_json)),
  cwd_display TEXT NOT NULL,
  registered_at TEXT NOT NULL, released_at TEXT, ended_at TEXT,
  exit_code INTEGER, exit_signal TEXT,
  cancellation_json TEXT CHECK (cancellation_json IS NULL OR json_valid(cancellation_json)),
  UNIQUE (session_id, run_id)
) STRICT;

CREATE TABLE agent_sessions (
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  agent TEXT NOT NULL, adapter_id TEXT NOT NULL, provider TEXT NOT NULL, color TEXT,
  requested_model TEXT NOT NULL, resolved_model TEXT,
  model_provenance TEXT CHECK (model_provenance IN ('stream-authoritative','route-attributed')),
  host_continuity_ref TEXT,
  context_tokens   INTEGER,                          -- occupancy after the LAST turn, not a sum
  context_window   INTEGER,                          -- NULL = catalog declares no ceiling
  call_count       INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0),
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  reasoning_tokens INTEGER, total_tokens INTEGER,
  estimated_cost_usd REAL,
  cost_authority   TEXT NOT NULL DEFAULT 'unavailable'
                   CHECK (cost_authority IN ('provider','catalog-estimate','unavailable')),
  created_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
  PRIMARY KEY (session_id, agent)
) STRICT;

CREATE INDEX idx_sessions_recent      ON sessions(archived, started_at DESC, session_id);
CREATE INDEX idx_sessions_state       ON sessions(lifecycle_state, started_at DESC);
CREATE INDEX idx_sessions_task        ON sessions(project_slug, task_id, attempt DESC);
CREATE INDEX idx_transitions_session  ON transitions(session_id, seq);
CREATE INDEX idx_phases_session       ON phases(session_id, ordinal);
CREATE INDEX idx_events_cursor        ON events(session_id, event_row);
CREATE INDEX idx_events_phase_cursor  ON events(phase_id, event_row);
CREATE INDEX idx_events_type          ON events(session_id, type, event_row);
CREATE INDEX idx_envelopes_phase      ON envelopes(phase_id, created_at);
CREATE INDEX idx_gates_phase          ON gate_results(phase_id, correction_round, gate_id);
CREATE INDEX idx_processes_live       ON processes(session_id, status)
                                      WHERE status IN ('RESERVED','REGISTERED','RUNNING');
CREATE INDEX idx_agent_sessions       ON agent_sessions(session_id, last_used_at);

PRAGMA user_version = 1;

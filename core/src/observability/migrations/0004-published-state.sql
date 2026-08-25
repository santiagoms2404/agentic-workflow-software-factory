PRAGMA foreign_keys = OFF;

-- SQLite cannot alter the CHECK.
-- Rebuild sessions to admit PUBLISHED.

   CREATE TABLE sessions_new (
     session_id             TEXT PRIMARY KEY,
     project_slug           TEXT NOT NULL,
     task_id                TEXT NOT NULL,
     attempt                INTEGER NOT NULL CHECK (attempt
 >= 1),
     workflow_id            TEXT NOT NULL,
     risk_tier              INTEGER NOT NULL CHECK (risk_tier
 IN (0,1,2)),
     is_protected           INTEGER NOT NULL CHECK
 (is_protected IN (0,1)),
     lifecycle_state        TEXT NOT NULL CHECK
 (lifecycle_state IN (

 'DRAFT','PREPARED','RUNNING','GATING','REVIEWING',

 'AWAITING_OWNER','LANDING','LANDED','PUBLISHED',
                              'BLOCKED','CANCELLED')),
     request_text           TEXT NOT NULL,
     base_sha               TEXT,
     head_sha               TEXT,
     candidate_sha          TEXT,
     worker_provider        TEXT,
     worker_model_requested TEXT,
     worker_model_resolved  TEXT,
     review_provider        TEXT,
     review_verdict         TEXT,
     call_ceiling           INTEGER NOT NULL,
     calls_reserved         INTEGER NOT NULL DEFAULT 0 CHECK
 (calls_reserved >= 0),
     calls_spent            INTEGER NOT NULL DEFAULT 0 CHECK
 (calls_spent >= 0),
     corrections_auto       INTEGER NOT NULL DEFAULT 0,
     corrections_owner      INTEGER NOT NULL DEFAULT 0,
     input_tokens           INTEGER,
     output_tokens          INTEGER,
     cache_read_tokens      INTEGER,
     cache_write_tokens     INTEGER,
     reasoning_tokens       INTEGER,
     total_tokens           INTEGER,
     reasoning_relation     TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (reasoning_relation IN
 ('included-in-output','additive','unknown')),
     usage_authority        TEXT NOT NULL DEFAULT 'none'
                            CHECK (usage_authority IN
 ('provider','partial','none')),
     estimated_cost_usd     REAL,
     cost_authority         TEXT NOT NULL DEFAULT
 'unavailable'
                            CHECK (cost_authority IN
 ('provider','catalog-estimate','unavailable')),
     cost_partial           INTEGER NOT NULL DEFAULT 0 CHECK
 (cost_partial IN (0,1)),
     observability_degraded INTEGER NOT NULL DEFAULT 0 CHECK
 (observability_degraded IN (0,1)),
     archived               INTEGER NOT NULL DEFAULT 0 CHECK
 (archived IN (0,1)),
     started_at             TEXT NOT NULL,
     updated_at             TEXT NOT NULL,
     ended_at               TEXT,
     state_revision         INTEGER NOT NULL DEFAULT 0 CHECK
 (state_revision >= 0),
     last_projected_seq     INTEGER NOT NULL DEFAULT 0 CHECK
 (last_projected_seq >= 0),
     config_snapshot_json   TEXT NOT NULL CHECK
 (json_valid(config_snapshot_json)),
     journal_path           TEXT NOT NULL,
     owner_reentries        INTEGER NOT NULL DEFAULT 0,
     UNIQUE (project_slug, task_id, attempt)
   ) STRICT;

   INSERT INTO sessions_new (
     session_id,
     project_slug,
     task_id,
     attempt,
     workflow_id,
     risk_tier,
     is_protected,
     lifecycle_state,
     request_text,
     base_sha,
     head_sha,
     candidate_sha,
     worker_provider,
     worker_model_requested,
     worker_model_resolved,
     review_provider,
     review_verdict,
     call_ceiling,
     calls_reserved,
     calls_spent,
     corrections_auto,
     corrections_owner,
     input_tokens,
     output_tokens,
     cache_read_tokens,
     cache_write_tokens,
     reasoning_tokens,
     total_tokens,
     reasoning_relation,
     usage_authority,
     estimated_cost_usd,
     cost_authority,
     cost_partial,
     observability_degraded,
     archived,
     started_at,
     updated_at,
     ended_at,
     state_revision,
     last_projected_seq,
     config_snapshot_json,
     journal_path,
     owner_reentries
   )
   SELECT
     session_id,
     project_slug,
     task_id,
     attempt,
     workflow_id,
     risk_tier,
     is_protected,
     lifecycle_state,
     request_text,
     base_sha,
     head_sha,
     candidate_sha,
     worker_provider,
     worker_model_requested,
     worker_model_resolved,
     review_provider,
     review_verdict,
     call_ceiling,
     calls_reserved,
     calls_spent,
     corrections_auto,
     corrections_owner,
     input_tokens,
     output_tokens,
     cache_read_tokens,
     cache_write_tokens,
     reasoning_tokens,
     total_tokens,
     reasoning_relation,
     usage_authority,
     estimated_cost_usd,
     cost_authority,
     cost_partial,
     observability_degraded,
     archived,
     started_at,
     updated_at,
     ended_at,
     state_revision,
     last_projected_seq,
     config_snapshot_json,
     journal_path,
     owner_reentries
   FROM sessions;

   DROP TABLE sessions;
   ALTER TABLE sessions_new RENAME TO sessions;

   CREATE INDEX idx_sessions_recent
     ON sessions(archived, started_at DESC, session_id);
   CREATE INDEX idx_sessions_state
     ON sessions(lifecycle_state, started_at DESC);
   CREATE INDEX idx_sessions_task
     ON sessions(project_slug, task_id, attempt DESC);

   PRAGMA user_version = 4;
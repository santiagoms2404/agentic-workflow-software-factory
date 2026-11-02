PRAGMA foreign_keys = OFF;

-- SQLite cannot alter the CHECK.
-- Rebuild transitions to admit 'delegate' actor (AGENTS.md invariant 13).

CREATE TABLE transitions_new (
  transition_id  TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE RESTRICT,
  seq            INTEGER NOT NULL CHECK (seq >= 1),
  from_state     TEXT NOT NULL,
  to_state       TEXT NOT NULL,
  actor          TEXT NOT NULL CHECK (actor IN ('host','owner','human','delegate')),
  edge_id        TEXT NOT NULL,
  reason_source  TEXT NOT NULL,
  reason_code    TEXT,
  reason_detail  TEXT,
  spawn_site     INTEGER NOT NULL DEFAULT 0 CHECK (spawn_site IN (0,1)),
  at             TEXT NOT NULL,
  UNIQUE (session_id, seq)
) STRICT;

INSERT INTO transitions_new (
  transition_id, session_id, seq, from_state, to_state, actor,
  edge_id, reason_source, reason_code, reason_detail, spawn_site, at
) SELECT
  transition_id, session_id, seq, from_state, to_state, actor,
  edge_id, reason_source, reason_code, reason_detail, spawn_site, at
FROM transitions;

DROP TABLE transitions;

ALTER TABLE transitions_new RENAME TO transitions;

CREATE INDEX idx_transitions_session ON transitions(session_id, seq);

PRAGMA foreign_keys = ON;

PRAGMA user_version = 8;

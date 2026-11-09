-- Metrics filter a small set of event types across the full projection.
-- Type-leading indexes avoid scanning unrelated text.delta and other rows.
CREATE INDEX idx_events_type_phase_cursor ON events(type, phase_id, event_row);
CREATE INDEX idx_events_type_session_cursor ON events(type, session_id, event_row);
PRAGMA user_version = 9;

ALTER TABLE agent_sessions ADD COLUMN sandbox_badge TEXT
  CHECK (sandbox_badge IS NULL OR sandbox_badge IN ('os-enforced','tool-policy','unavailable'));

ALTER TABLE agent_sessions ADD COLUMN sandbox_mechanism TEXT
  CHECK (sandbox_mechanism IS NULL OR sandbox_mechanism IN ('linux-bwrap','adapter-tool-policy','none'));

PRAGMA user_version = 2;

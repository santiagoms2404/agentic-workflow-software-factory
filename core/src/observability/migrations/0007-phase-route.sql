-- The route each agent phase actually ran on: adapter, provider, model, effort,
-- and where the effort came from.
--
-- Route provenance has been journaled as a `route_resolution` event since
-- 2026-09-06, and every session's config snapshot carries each agent's
-- `thinking`, so the value is recoverable for every phase. These columns hold
-- it on the phase row, where the metrics readers query it directly.
--
-- Written only by the projector (invariant 6): from the phase's route event
-- when one exists (`journal`), else from the session's config snapshot.
-- Legacy rows stay NULL until `awsf db rebuild` replays them. NULL means
-- unresolved, never a value.
ALTER TABLE phases ADD COLUMN route_adapter TEXT;
ALTER TABLE phases ADD COLUMN route_provider TEXT;
ALTER TABLE phases ADD COLUMN route_model TEXT;
ALTER TABLE phases ADD COLUMN route_effort TEXT
  CHECK (route_effort IS NULL OR route_effort IN ('none','low','medium','high','xhigh','max'));
ALTER TABLE phases ADD COLUMN effort_source TEXT
  CHECK (effort_source IS NULL OR effort_source IN ('journal','config-phase-route','config-agent','unknown'));

PRAGMA user_version = 7;

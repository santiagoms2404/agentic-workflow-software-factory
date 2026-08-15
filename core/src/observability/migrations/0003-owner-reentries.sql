-- The owner correction allowance was one pair of counters carrying two
-- different allowances: the per-PHASE intra-phase correction, refreshed by
-- every new phase, and the per-ATTEMPT owner re-entry drawn by L10-owner, L16,
-- L19 and L25. `owner_reentries` is the second one, so a phase beginning after
-- an owner re-entry can no longer refund it.
--
-- Legacy sessions default to 0, which is the honest value: the counter that
-- could have charged them did not exist.
ALTER TABLE sessions ADD COLUMN owner_reentries INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 3;

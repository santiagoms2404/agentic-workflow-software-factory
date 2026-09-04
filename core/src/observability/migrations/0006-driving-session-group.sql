-- The group a run belongs to: one driving session's worth of work.
--
-- A group is NOT a continuation chain. A chain records that one task continues
-- another and may run inside a group or across two of them. A group records
-- that a set of tasks came out of the same driving session, which is where the
-- decisions that shaped them were made. They are different edges, and answering
-- one with the other loses whichever question you did not ask.
--
-- Minted by the driving session, not derived. Nothing in the factory identifies
-- a driving session, and inferring one from timing or adjacency would be a
-- guess dressed as a record.
--
-- Legacy rows default to NULL, which is the honest value: no group existed when
-- they ran.
ALTER TABLE sessions ADD COLUMN group_id TEXT;

PRAGMA user_version = 6;
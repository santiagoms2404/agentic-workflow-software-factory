-- Two edges the dashboard needs and the projection never carried.
--
-- `continues_task` is the owner-declared link between a task and the one it
-- continues: a reattempt after a block, or a fresh task that reuses a sealed
-- attempt's findings. It is deliberately NOT inferred from the task id, which
-- has no convention, and NOT the same as `attempt` — attempts share a task,
-- continuations do not.
--
-- `plan_ref` is the plan a run belongs to when its task was not named after a
-- ticket uid. Today the only session-to-plan link is `task_id` matching a
-- ticket uid exactly, which zero of the existing runs do.
--
-- Legacy rows default to NULL, which is the honest value: nothing recorded the
-- edge when they ran.
ALTER TABLE sessions ADD COLUMN continues_task TEXT;
ALTER TABLE sessions ADD COLUMN plan_ref TEXT;

PRAGMA user_version = 5;
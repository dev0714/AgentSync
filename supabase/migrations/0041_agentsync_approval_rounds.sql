-- A gate can be decided more than once: a plan sent back comes to the plan
-- gate again, a pull request sent back to the merge gate again. Each round is
-- its own approval row (the earlier ones are the history, and their comments
-- are the feedback the agents read). Only one may be pending at a time.

alter table agentsync.task_approvals drop constraint if exists task_approvals_task_id_gate_key;

create unique index if not exists task_approvals_one_pending
  on agentsync.task_approvals (task_id, gate)
  where decision = 'pending';

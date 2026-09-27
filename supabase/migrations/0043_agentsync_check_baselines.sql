-- What the project's own checks do on its default branch, as the Engineer last
-- found them: which pass and which were already failing. The next sandbox
-- session is told, so it neither re-runs the checks on the default branch to
-- compare nor tries to repair failures that were there before its change.
-- Worker-only: row-level security with no policies, reached through the
-- functions below by the service role.

create table if not exists agentsync.project_check_baselines (
  project_id uuid primary key references agentsync.projects(id) on delete cascade,
  commit_sha text,
  checks jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now()
);
alter table agentsync.project_check_baselines enable row level security;

create or replace function public.agentsync_check_baseline_get(p_project_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(b) from agentsync.project_check_baselines b where b.project_id = p_project_id;
$$;

create or replace function public.agentsync_check_baseline_set(p_project_id uuid, p_sha text, p_checks jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into agentsync.project_check_baselines (project_id, commit_sha, checks, recorded_at)
  values (p_project_id, p_sha, coalesce(p_checks, '[]'::jsonb), now())
  on conflict (project_id) do update
    set commit_sha = excluded.commit_sha, checks = excluded.checks, recorded_at = now();
$$;

revoke all on function public.agentsync_check_baseline_get(uuid) from public, anon, authenticated;
revoke all on function public.agentsync_check_baseline_set(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.agentsync_check_baseline_get(uuid) to service_role;
grant execute on function public.agentsync_check_baseline_set(uuid, text, jsonb) to service_role;

-- What past tasks taught about each project's code map. Each finished task
-- leaves one outcome against the map nodes it worked from, in Graphify's
-- save-result terms: useful (merged), dead_end (failed or rejected without a
-- reason) or corrected (a person asked for changes, with what to do instead).
-- A map run writes them as Graphify memory files and `graphify reflect` turns
-- them into LESSONS.md, which the agents read.

create table agentsync.project_map_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references agentsync.projects (id) on delete cascade,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  task_id uuid references agentsync.agent_tasks (id) on delete set null,
  question text not null,
  answer text,
  source_nodes text[] not null default '{}',
  outcome text not null check (outcome in ('useful', 'dead_end', 'corrected')),
  correction text,
  created_at timestamptz not null default now()
);

create index project_map_feedback_project on agentsync.project_map_feedback (project_id, created_at desc);

alter table agentsync.project_map_feedback enable row level security;

-- Records an outcome for a task: the question is its title, the answer its
-- latest plan's summary. Nothing is recorded for a task that never used a map.
create or replace function public.agentsync_map_feedback_add(
  p_task_id uuid, p_outcome text, p_nodes text[], p_correction text default null
)
returns void
language sql security definer set search_path = ''
as $$
  insert into agentsync.project_map_feedback (project_id, tenant_id, task_id, question, answer, source_nodes, outcome, correction)
  select t.project_id, t.tenant_id, t.id, t.title,
         (select pl.summary from agentsync.task_plans pl where pl.task_id = t.id order by pl.version desc limit 1),
         coalesce(p_nodes, '{}'), p_outcome, nullif(btrim(coalesce(p_correction, '')), '')
    from agentsync.agent_tasks t
   where t.id = p_task_id and coalesce(array_length(p_nodes, 1), 0) > 0;
$$;

-- What a map run needs besides the code: the tenant's Anthropic key (by
-- reference, for naming groups) and the project's recorded outcomes.
create or replace function public.agentsync_map_inputs(p_project_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'anthropic_key_reference', (
      select a.key_reference from agentsync.ai_provider_credentials a
       where (a.tenant_id = p.tenant_id or a.tenant_id is null) and a.provider = 'anthropic'
       order by a.tenant_id nulls last limit 1),
    'feedback', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.created_at desc)
        from (select * from agentsync.project_map_feedback f
               where f.project_id = p.id order by f.created_at desc limit 300) f), '[]'::jsonb)
  )
  from agentsync.projects p where p.id = p_project_id;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agentsync_map_feedback_add(uuid, text, text[], text)',
    'public.agentsync_map_inputs(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

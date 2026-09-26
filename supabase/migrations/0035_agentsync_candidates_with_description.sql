-- The router reads each candidate repository's AGENTSYNC.md (the start of it)
-- as well as its name, hint and recent task titles.
create or replace function agentsync.client_candidates(p_source_client_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'project_id', p.id,
           'name', p.name,
           'repository', (select r.github_owner || '/' || r.repository from agentsync.project_repositories r
                           where r.project_id = p.id order by r.created_at limit 1),
           'hint', m.hint,
           'description', (select left(v.content, 1500) from agentsync.project_document_versions v
                             join agentsync.project_documents d on d.project_id = v.project_id and d.current_version = v.version
                            where v.project_id = p.id),
           'recent_titles', coalesce((select jsonb_agg(x.title) from (
               select t.title from agentsync.agent_tasks t
                where t.project_id = p.id order by t.created_at desc limit 5) x), '[]'::jsonb)
         ) order by lower(p.name)), '[]'::jsonb)
    from agentsync.source_client_projects m
    join agentsync.projects p on p.id = m.project_id
   where m.source_client_id = p_source_client_id and p.enabled;
$$;

revoke all on function agentsync.client_candidates(uuid) from public, anon, authenticated;
grant execute on function agentsync.client_candidates(uuid) to service_role;

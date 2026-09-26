-- Each repository the GitHub App is installed on is a project.
--
-- Projects are no longer typed in by hand: connecting GitHub (and every later
-- change to the installation's repository selection) syncs them. A repository
-- that is removed from the installation disables its project rather than
-- deleting it, so its task history stays; adding it back re-enables it.

create unique index if not exists project_repositories_tenant_repo_key
  on agentsync.project_repositories (tenant_id, lower(github_owner), lower(repository));

create or replace function public.agentsync_sync_github_projects(
  p_user_id uuid,
  p_tenant_slug text,
  p_repos jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_repo jsonb;
  v_owner text;
  v_name text;
  v_branch text;
  v_project uuid;
  v_enabled boolean;
  v_slug text;
  v_created integer := 0;
  v_enabled_count integer := 0;
  v_disabled integer := 0;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if jsonb_typeof(p_repos) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'BAD_REPOSITORY_LIST');
  end if;

  for v_repo in select * from jsonb_array_elements(p_repos) loop
    v_owner := trim(v_repo->>'owner');
    v_name := trim(v_repo->>'name');
    v_branch := coalesce(nullif(trim(v_repo->>'default_branch'), ''), 'main');
    continue when coalesce(v_owner, '') = '' or coalesce(v_name, '') = '';

    select r.project_id, p.enabled into v_project, v_enabled
      from agentsync.project_repositories r
      join agentsync.projects p on p.id = r.project_id
     where r.tenant_id = v_tenant
       and lower(r.github_owner) = lower(v_owner)
       and lower(r.repository) = lower(v_name);

    if v_project is null then
      v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
      if exists (select 1 from agentsync.projects where tenant_id = v_tenant and slug = v_slug) then
        v_slug := trim(both '-' from regexp_replace(lower(v_owner || '-' || v_name), '[^a-z0-9]+', '-', 'g'));
      end if;

      insert into agentsync.projects (tenant_id, name, slug, plan_approval_required, merge_approval_required)
      values (v_tenant, v_name, v_slug, true, true)
      returning id into v_project;

      insert into agentsync.project_repositories (
        tenant_id, project_id, github_owner, repository, default_branch, protected_paths
      ) values (
        v_tenant, v_project, v_owner, v_name, v_branch,
        array['.github/workflows/**', '.env*', '**/*.pem']
      );
      v_created := v_created + 1;
    else
      update agentsync.project_repositories
         set default_branch = v_branch, updated_at = now()
       where project_id = v_project;
      if not v_enabled then
        update agentsync.projects set enabled = true, updated_at = now() where id = v_project;
        v_enabled_count := v_enabled_count + 1;
      end if;
    end if;
    v_project := null;
  end loop;

  -- Repositories no longer in the installation: keep the project, stop work on it.
  with gone as (
    update agentsync.projects p
       set enabled = false, updated_at = now()
      from agentsync.project_repositories r
     where r.project_id = p.id
       and p.tenant_id = v_tenant
       and p.enabled
       and not exists (
         select 1 from jsonb_array_elements(p_repos) x
          where lower(x->>'owner') = lower(r.github_owner)
            and lower(x->>'name') = lower(r.repository)
       )
    returning 1
  )
  select count(*) into v_disabled from gone;

  return jsonb_build_object('ok', true, 'created', v_created,
                            'enabled', v_enabled_count, 'disabled', v_disabled);
end;
$$;

-- The tenant's GitHub connection, for a manual "Sync from GitHub".
create or replace function public.agentsync_github_connection_for_tenant(
  p_user_id uuid, p_tenant_slug text
)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
           'tenant_slug', t.slug,
           'app_slug', g.app_slug,
           'app_id', g.app_id,
           'installation_id', g.installation_id,
           'key_ref', g.private_key_reference
         )
    from agentsync.github_app_installations g
    join agentsync.tenants t on t.id = g.tenant_id
   where t.slug = p_tenant_slug
     and agentsync.configurable_tenant(p_user_id, t.slug) is not null;
$$;

-- Projects come from repositories now; the hand-made project form is gone.
drop function if exists public.agentsync_create_project(uuid, text, text, text, text, text, boolean, text[]);

revoke all on function public.agentsync_sync_github_projects(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_github_connection_for_tenant(uuid, text) from public, anon, authenticated;
grant execute on function public.agentsync_sync_github_projects(uuid, text, jsonb) to service_role;
grant execute on function public.agentsync_github_connection_for_tenant(uuid, text) to service_role;

-- Lookups the one-click GitHub flow needs to finish or refresh a connection
-- without asking the person to copy anything.

-- Apps created through the one-click flow whose key is stored but which never
-- got recorded as a connection (the flow was interrupted, or failed at the
-- last step). Limited to tenants the user may configure. New keys are stored
-- with purpose `github_app:<slug>#<app id>`; older ones carry only the slug.
create or replace function public.agentsync_unfinished_github_apps(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'tenant_slug', t.slug,
           'app_slug', split_part(substr(s.purpose, length('github_app:') + 1), '#', 1),
           'app_id', nullif(split_part(s.purpose, '#', 2), '')::bigint,
           'key_ref', 'db:' || s.id::text,
           'created_at', s.created_at
         ) order by s.created_at desc), '[]'::jsonb)
    from agentsync.encrypted_secrets s
    join agentsync.tenants t on t.id = s.tenant_id
   where s.purpose like 'github_app:%'
     and s.created_at > now() - interval '7 days'
     and agentsync.configurable_tenant(p_user_id, t.slug) is not null
     and not exists (
       select 1 from agentsync.github_app_installations g
        where g.private_key_reference = 'db:' || s.id::text
     );
$$;

-- The existing connection for an installation, so returning from GitHub's
-- "configure" page (repositories added or removed) can refresh the allowlist.
create or replace function public.agentsync_github_connection_for_installation(
  p_user_id uuid, p_installation_id bigint
)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
           'tenant_slug', t.slug,
           'app_slug', g.app_slug,
           'app_id', g.app_id,
           'key_ref', g.private_key_reference
         )
    from agentsync.github_app_installations g
    join agentsync.tenants t on t.id = g.tenant_id
   where g.installation_id = p_installation_id
     and agentsync.configurable_tenant(p_user_id, t.slug) is not null
   limit 1;
$$;

revoke all on function public.agentsync_unfinished_github_apps(uuid) from public, anon, authenticated;
revoke all on function public.agentsync_github_connection_for_installation(uuid, bigint) from public, anon, authenticated;
grant execute on function public.agentsync_unfinished_github_apps(uuid) to service_role;
grant execute on function public.agentsync_github_connection_for_installation(uuid, bigint) to service_role;

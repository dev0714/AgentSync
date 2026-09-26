-- What the Agents screen needs to create or sync the Engineer in Claude:
-- the tenant's Engineer definition, which Anthropic credential it runs under
-- (the tenant's own, else the platform key), and what already exists in
-- Claude for that credential.

create or replace function public.agentsync_managed_engineer_context(
  p_user_id uuid, p_tenant_slug text
)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with tenant as (
    select t.id from agentsync.tenants t
     where t.slug = p_tenant_slug
       and (exists (select 1 from agentsync.users u where u.id = p_user_id and u.state = 'ACTIVE' and u.role = 'SUPER_ADMIN')
            or exists (select 1 from agentsync.tenant_users tu
                        where tu.tenant_id = t.id and tu.user_id = p_user_id and tu.state = 'ACTIVE'))
  ),
  cred as (
    select a.key_reference from agentsync.ai_provider_credentials a
     where (a.tenant_id = (select id from tenant) or a.tenant_id is null)
       and a.provider = 'anthropic'
     order by a.tenant_id nulls last limit 1
  ),
  eng as (
    select to_jsonb(a) as def from agentsync.agent_definitions a
     where a.key = 'engineer' and a.project_id is null
       and (a.tenant_id is null or a.tenant_id = (select id from tenant))
     order by a.tenant_id nulls last limit 1
  )
  select jsonb_build_object(
    'can_edit', agentsync.configurable_tenant(p_user_id, p_tenant_slug) is not null,
    'engineer', (select def from eng),
    'credential_key', coalesce((select key_reference from cred), 'env:ANTHROPIC_API_KEY'),
    'setup', (select to_jsonb(s) from agentsync.managed_agent_setup s
               where s.credential_key = coalesce((select key_reference from cred), 'env:ANTHROPIC_API_KEY'))
  )
  where exists (select 1 from tenant);
$$;

revoke all on function public.agentsync_managed_engineer_context(uuid, text) from public, anon, authenticated;
grant execute on function public.agentsync_managed_engineer_context(uuid, text) to service_role;

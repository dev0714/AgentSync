-- Recording a deployment provider from the portal.

create unique index if not exists deployment_providers_tenant_key
  on agentsync.deployment_providers (tenant_id);

-- A secret reference names where a secret lives; it is never the secret.
--
-- Until now that was a convention plus a check for pasted private keys, which
-- catches a .pem and nothing else — a Vercel API token is an unremarkable
-- 24-character string and would have sailed through. Requiring a scheme makes
-- the distinction checkable: env:VERCEL_API_TOKEN is a reference, the token
-- itself cannot be one.
create or replace function agentsync.is_secret_reference(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
     and length(p_value) between 3 and 200
     and p_value ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]+$'
     and p_value !~ 'BEGIN [A-Z ]*PRIVATE KEY';
$$;

-- token_scope is NOT NULL, and it should be: it records what the stored token
-- is actually allowed to do. Defaulting it would put a claim on the record that
-- nobody made, so the caller has to state it.
create or replace function agentsync.connect_deployment(
  p_user_id uuid,
  p_tenant_slug text,
  p_provider text,
  p_api_token_reference text,
  p_team_id text default null,
  p_token_scope text default null,
  p_preview_on text default 'pull_request',
  p_production_trigger text default 'merge',
  p_promote_via_api boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_platform_role agentsync.user_role;
  v_role agentsync.user_role;
  v_scope text;
begin
  select u.role into v_platform_role
    from agentsync.users u where u.id = p_user_id and u.state = 'ACTIVE';
  if v_platform_role is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  select t.id into v_tenant from agentsync.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_TENANT');
  end if;

  select tu.role into v_role
    from agentsync.tenant_users tu
   where tu.tenant_id = v_tenant and tu.user_id = p_user_id and tu.state = 'ACTIVE';

  if v_platform_role <> 'SUPER_ADMIN'
     and coalesce(v_role, 'VIEWER') not in ('SUPER_ADMIN', 'TENANT_ADMIN') then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  if p_provider not in ('vercel', 'netlify', 'cloudflare_pages', 'render') then
    return jsonb_build_object('ok', false, 'error', 'UNSUPPORTED_PROVIDER', 'detail', p_provider);
  end if;

  if not agentsync.is_secret_reference(p_api_token_reference) then
    return jsonb_build_object('ok', false, 'error', 'SECRET_VALUE_NOT_A_REFERENCE');
  end if;

  v_scope := nullif(trim(coalesce(p_token_scope, '')), '');
  if v_scope is null then
    return jsonb_build_object('ok', false, 'error', 'TOKEN_SCOPE_REQUIRED');
  end if;

  if p_preview_on not in ('pull_request', 'branch_push', 'never') then
    return jsonb_build_object('ok', false, 'error', 'BAD_PREVIEW_TRIGGER');
  end if;

  if p_production_trigger not in ('merge', 'approval', 'manual') then
    return jsonb_build_object('ok', false, 'error', 'BAD_PRODUCTION_TRIGGER');
  end if;

  -- Promoting through the provider's API bypasses whatever the provider's own
  -- git integration would do on merge; asking for it while production is only
  -- triggered manually is a configuration that contradicts itself.
  if p_promote_via_api and p_production_trigger = 'manual' then
    return jsonb_build_object('ok', false, 'error', 'PROMOTION_CONTRADICTION');
  end if;

  insert into agentsync.deployment_providers as d (
    tenant_id, provider, team_id, api_token_reference, token_scope,
    preview_on, production_trigger, promote_via_api
  ) values (
    v_tenant, p_provider, nullif(trim(coalesce(p_team_id, '')), ''),
    trim(p_api_token_reference), v_scope,
    p_preview_on, p_production_trigger, p_promote_via_api
  )
  on conflict (tenant_id) do update set
    provider = excluded.provider,
    team_id = excluded.team_id,
    api_token_reference = excluded.api_token_reference,
    token_scope = excluded.token_scope,
    preview_on = excluded.preview_on,
    production_trigger = excluded.production_trigger,
    promote_via_api = excluded.promote_via_api;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function agentsync.disconnect_deployment(
  p_user_id uuid,
  p_tenant_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_platform_role agentsync.user_role;
  v_role agentsync.user_role;
begin
  select u.role into v_platform_role
    from agentsync.users u where u.id = p_user_id and u.state = 'ACTIVE';
  select t.id into v_tenant from agentsync.tenants t where t.slug = p_tenant_slug;
  if v_platform_role is null or v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  select tu.role into v_role
    from agentsync.tenant_users tu
   where tu.tenant_id = v_tenant and tu.user_id = p_user_id and tu.state = 'ACTIVE';

  if v_platform_role <> 'SUPER_ADMIN'
     and coalesce(v_role, 'VIEWER') not in ('SUPER_ADMIN', 'TENANT_ADMIN') then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  delete from agentsync.deployment_providers where tenant_id = v_tenant;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- public wrappers, service_role only
-- ---------------------------------------------------------------------------

create or replace function public.agentsync_connect_deployment(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$
  select agentsync.connect_deployment(
    (payload->>'user_id')::uuid,
    payload->>'tenant_slug',
    payload->>'provider',
    payload->>'api_token_reference',
    payload->>'team_id',
    payload->>'token_scope',
    coalesce(nullif(payload->>'preview_on',''), 'pull_request'),
    coalesce(nullif(payload->>'production_trigger',''), 'merge'),
    coalesce((payload->>'promote_via_api')::boolean, false)
  );
$$;

create or replace function public.agentsync_disconnect_deployment(
  p_user_id uuid, p_tenant_slug text
)
returns jsonb language sql security definer set search_path = ''
as $$ select agentsync.disconnect_deployment(p_user_id, p_tenant_slug); $$;

revoke all on function public.agentsync_connect_deployment(jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_disconnect_deployment(uuid, text) from public, anon, authenticated;
revoke all on function agentsync.connect_deployment(uuid, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function agentsync.disconnect_deployment(uuid, text) from public, anon, authenticated;
revoke all on function agentsync.is_secret_reference(text) from public, anon, authenticated;

grant execute on function public.agentsync_connect_deployment(jsonb) to service_role;
grant execute on function public.agentsync_disconnect_deployment(uuid, text) to service_role;
grant execute on function agentsync.connect_deployment(uuid, text, text, text, text, text, text, text, boolean) to service_role;
grant execute on function agentsync.disconnect_deployment(uuid, text) to service_role;
grant execute on function agentsync.is_secret_reference(text) to service_role;

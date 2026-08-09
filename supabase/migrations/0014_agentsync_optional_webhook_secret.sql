-- The webhook secret is optional until there is something to receive webhooks.
--
-- Nothing in AgentSync accepts a GitHub webhook yet, so the correct App
-- configuration today has the webhook switched off — and then there is no
-- secret to reference. Requiring one would only force a placeholder, which is
-- the kind of invented value this schema is meant to avoid.
alter table agentsync.github_app_installations
  alter column webhook_secret_reference drop not null;

create or replace function agentsync.connect_github(
  p_user_id uuid,
  p_tenant_slug text,
  p_app_slug text,
  p_app_id bigint,
  p_installation_id bigint,
  p_private_key_reference text,
  p_webhook_secret_reference text default null,
  p_repository_allowlist text[] default '{}',
  p_token_ttl_minutes integer default 55,
  p_branch_protection_writes boolean default false
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
  v_repo text;
  v_hook text;
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

  if coalesce(trim(p_app_slug), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'APP_SLUG_REQUIRED');
  end if;
  if p_app_id is null or p_app_id <= 0 then
    return jsonb_build_object('ok', false, 'error', 'APP_ID_REQUIRED');
  end if;
  if p_installation_id is null or p_installation_id <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INSTALLATION_ID_REQUIRED');
  end if;
  if p_app_id = p_installation_id then
    return jsonb_build_object('ok', false, 'error', 'APP_ID_EQUALS_INSTALLATION_ID');
  end if;
  if coalesce(trim(p_private_key_reference), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'SECRET_REFERENCE_REQUIRED');
  end if;

  v_hook := nullif(trim(coalesce(p_webhook_secret_reference, '')), '');

  -- A reference points at a secret; it is never the secret.
  if p_private_key_reference ~ 'BEGIN [A-Z ]*PRIVATE KEY'
     or length(p_private_key_reference) > 200
     or length(coalesce(v_hook, '')) > 200 then
    return jsonb_build_object('ok', false, 'error', 'SECRET_VALUE_NOT_A_REFERENCE');
  end if;

  if p_token_ttl_minutes is null or p_token_ttl_minutes < 5 or p_token_ttl_minutes > 60 then
    return jsonb_build_object('ok', false, 'error', 'TOKEN_TTL_OUT_OF_RANGE');
  end if;

  if p_repository_allowlist is null or array_length(p_repository_allowlist, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'REPOSITORY_REQUIRED');
  end if;

  foreach v_repo in array p_repository_allowlist loop
    if v_repo !~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$' then
      return jsonb_build_object('ok', false, 'error', 'BAD_REPOSITORY', 'detail', v_repo);
    end if;
  end loop;

  insert into agentsync.github_app_installations as g (
    tenant_id, app_slug, app_id, installation_id,
    private_key_reference, webhook_secret_reference,
    repository_allowlist, token_ttl_minutes, branch_protection_writes
  ) values (
    v_tenant, trim(p_app_slug), p_app_id, p_installation_id,
    trim(p_private_key_reference), v_hook,
    p_repository_allowlist, p_token_ttl_minutes, p_branch_protection_writes
  )
  on conflict (tenant_id) do update set
    app_slug = excluded.app_slug,
    app_id = excluded.app_id,
    installation_id = excluded.installation_id,
    private_key_reference = excluded.private_key_reference,
    webhook_secret_reference = excluded.webhook_secret_reference,
    repository_allowlist = excluded.repository_allowlist,
    token_ttl_minutes = excluded.token_ttl_minutes,
    branch_protection_writes = excluded.branch_protection_writes;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function agentsync.connect_github(uuid, text, text, bigint, bigint, text, text, text[], integer, boolean) from public, anon, authenticated;
grant execute on function agentsync.connect_github(uuid, text, text, bigint, bigint, text, text, text[], integer, boolean) to service_role;

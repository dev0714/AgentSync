-- Recording a GitHub App installation from the portal.
--
-- The portal previously had nothing to offer here but a block of SQL to paste.
-- These functions let the front end write the row, with the checks that would
-- otherwise be a matter of trusting whoever typed the insert.

-- One GitHub App installation per tenant. The read path already assumed this
-- (it takes the first row); make the database enforce it so a second save
-- updates rather than quietly creating a duplicate the portal would never show.
create unique index if not exists github_app_installations_tenant_key
  on agentsync.github_app_installations (tenant_id);

create or replace function agentsync.connect_github(
  p_user_id uuid,
  p_tenant_slug text,
  p_app_slug text,
  p_installation_id bigint,
  p_private_key_reference text,
  p_webhook_secret_reference text,
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

  -- Connecting a repository host is a configuration change, not an operational
  -- one: a viewer or developer must not be able to point the platform at a
  -- different repository.
  if v_platform_role <> 'SUPER_ADMIN'
     and coalesce(v_role, 'VIEWER') not in ('SUPER_ADMIN', 'TENANT_ADMIN') then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  if coalesce(trim(p_app_slug), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'APP_SLUG_REQUIRED');
  end if;
  if p_installation_id is null or p_installation_id <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INSTALLATION_ID_REQUIRED');
  end if;
  if coalesce(trim(p_private_key_reference), '') = ''
     or coalesce(trim(p_webhook_secret_reference), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'SECRET_REFERENCE_REQUIRED');
  end if;

  -- A reference points at a secret; it is never the secret. Refuse anything
  -- that looks like the real thing so a private key cannot be pasted into a
  -- column that is read back to the browser.
  if p_private_key_reference ~ 'BEGIN [A-Z ]*PRIVATE KEY'
     or length(p_private_key_reference) > 200
     or length(p_webhook_secret_reference) > 200 then
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
    tenant_id, app_slug, installation_id,
    private_key_reference, webhook_secret_reference,
    repository_allowlist, token_ttl_minutes, branch_protection_writes
  ) values (
    v_tenant, trim(p_app_slug), p_installation_id,
    trim(p_private_key_reference), trim(p_webhook_secret_reference),
    p_repository_allowlist, p_token_ttl_minutes, p_branch_protection_writes
  )
  on conflict (tenant_id) do update set
    app_slug = excluded.app_slug,
    installation_id = excluded.installation_id,
    private_key_reference = excluded.private_key_reference,
    webhook_secret_reference = excluded.webhook_secret_reference,
    repository_allowlist = excluded.repository_allowlist,
    token_ttl_minutes = excluded.token_ttl_minutes,
    branch_protection_writes = excluded.branch_protection_writes;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function agentsync.disconnect_github(
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

  delete from agentsync.github_app_installations where tenant_id = v_tenant;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- public wrappers, service_role only
-- ---------------------------------------------------------------------------

create or replace function public.agentsync_connect_github(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$
  select agentsync.connect_github(
    (payload->>'user_id')::uuid,
    payload->>'tenant_slug',
    payload->>'app_slug',
    (payload->>'installation_id')::bigint,
    payload->>'private_key_reference',
    payload->>'webhook_secret_reference',
    coalesce(
      (select array_agg(value::text)
         from jsonb_array_elements_text(coalesce(payload->'repository_allowlist', '[]'::jsonb))),
      '{}'::text[]),
    coalesce((payload->>'token_ttl_minutes')::integer, 55),
    coalesce((payload->>'branch_protection_writes')::boolean, false)
  );
$$;

create or replace function public.agentsync_disconnect_github(
  p_user_id uuid, p_tenant_slug text
)
returns jsonb language sql security definer set search_path = ''
as $$ select agentsync.disconnect_github(p_user_id, p_tenant_slug); $$;

revoke all on function public.agentsync_connect_github(jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_disconnect_github(uuid, text) from public, anon, authenticated;
revoke all on function agentsync.connect_github(uuid, text, text, bigint, text, text, text[], integer, boolean) from public, anon, authenticated;
revoke all on function agentsync.disconnect_github(uuid, text) from public, anon, authenticated;

grant execute on function public.agentsync_connect_github(jsonb) to service_role;
grant execute on function public.agentsync_disconnect_github(uuid, text) to service_role;
grant execute on function agentsync.connect_github(uuid, text, text, bigint, text, text, text[], integer, boolean) to service_role;
grant execute on function agentsync.disconnect_github(uuid, text) to service_role;

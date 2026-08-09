-- The rest of the connections, writable from the portal.
--
-- AI credentials, webhook endpoints and secret references are lists rather than
-- single rows, so each gets an upsert keyed on its natural identity and a
-- delete, instead of the connect/disconnect pair the single-row connections use.

-- One place for the check every one of these repeats: returns the tenant id
-- when this user may configure it, null otherwise. Having it once means a new
-- connection type cannot quietly ship without the check.
create or replace function agentsync.configurable_tenant(
  p_user_id uuid,
  p_tenant_slug text
)
returns uuid
language plpgsql
stable
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
  if v_platform_role is null then return null; end if;

  select t.id into v_tenant from agentsync.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then return null; end if;

  select tu.role into v_role
    from agentsync.tenant_users tu
   where tu.tenant_id = v_tenant and tu.user_id = p_user_id and tu.state = 'ACTIVE';

  if v_platform_role = 'SUPER_ADMIN'
     or coalesce(v_role, 'VIEWER') in ('SUPER_ADMIN', 'TENANT_ADMIN') then
    return v_tenant;
  end if;
  return null;
end;
$$;

/* ---- AI provider credentials ----------------------------------------- */

create unique index if not exists ai_provider_credentials_tenant_provider_key
  on agentsync.ai_provider_credentials (tenant_id, provider);

create or replace function agentsync.upsert_ai_credential(
  p_user_id uuid,
  p_tenant_slug text,
  p_provider text,
  p_model text,
  p_key_reference text,
  p_failover_triggers text default null,
  p_failover_requires_optin boolean default true,
  p_monthly_cap numeric default null,
  p_hard_stop_at_cap boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  if p_provider not in ('anthropic', 'openai') then
    return jsonb_build_object('ok', false, 'error', 'UNSUPPORTED_PROVIDER', 'detail', p_provider);
  end if;

  if coalesce(trim(p_model), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'MODEL_REQUIRED');
  end if;

  if not agentsync.is_secret_reference(p_key_reference) then
    return jsonb_build_object('ok', false, 'error', 'SECRET_VALUE_NOT_A_REFERENCE');
  end if;

  if p_monthly_cap is not null and p_monthly_cap <= 0 then
    return jsonb_build_object('ok', false, 'error', 'CAP_MUST_BE_POSITIVE');
  end if;

  -- A cap that does not stop anything is not a cap. Allowing it would put a
  -- number on the screen that a reader would reasonably take as a limit.
  if p_monthly_cap is null and not p_hard_stop_at_cap then
    return jsonb_build_object('ok', false, 'error', 'NO_CAP_TO_ENFORCE');
  end if;

  insert into agentsync.ai_provider_credentials as c (
    tenant_id, provider, model, key_reference, failover_triggers,
    failover_requires_optin, monthly_cap, hard_stop_at_cap
  ) values (
    v_tenant, p_provider::agentsync.ai_provider, trim(p_model),
    trim(p_key_reference), nullif(trim(coalesce(p_failover_triggers, '')), ''),
    p_failover_requires_optin, p_monthly_cap, p_hard_stop_at_cap
  )
  on conflict (tenant_id, provider) do update set
    model = excluded.model,
    key_reference = excluded.key_reference,
    failover_triggers = excluded.failover_triggers,
    failover_requires_optin = excluded.failover_requires_optin,
    monthly_cap = excluded.monthly_cap,
    hard_stop_at_cap = excluded.hard_stop_at_cap;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function agentsync.delete_ai_credential(
  p_user_id uuid, p_tenant_slug text, p_provider text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  delete from agentsync.ai_provider_credentials
   where tenant_id = v_tenant and provider = p_provider::agentsync.ai_provider;
  return jsonb_build_object('ok', true);
end;
$$;

/* ---- webhook endpoints ------------------------------------------------ */

create unique index if not exists webhook_endpoints_tenant_path_key
  on agentsync.webhook_endpoints (tenant_id, path);

-- direction is constrained to 'IN' / 'OUT' by the original schema.
create or replace function agentsync.upsert_webhook_endpoint(
  p_user_id uuid,
  p_tenant_slug text,
  p_direction text,
  p_path text,
  p_note text default null,
  p_signing_secret_ref text default null,
  p_replay_window_seconds integer default 300,
  p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_ref text;
  v_dir text;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  v_dir := upper(trim(coalesce(p_direction, '')));
  if v_dir not in ('IN', 'OUT') then
    return jsonb_build_object('ok', false, 'error', 'BAD_DIRECTION');
  end if;

  -- Inbound endpoints are paths on this application; outbound ones are URLs
  -- somewhere else, and must be https because a callback carries task detail.
  if v_dir = 'IN' then
    if p_path !~ '^/[A-Za-z0-9/_.:-]*$' then
      return jsonb_build_object('ok', false, 'error', 'BAD_PATH');
    end if;
  else
    if p_path !~ '^https://[^[:space:]]+$' then
      return jsonb_build_object('ok', false, 'error', 'CALLBACK_MUST_BE_HTTPS');
    end if;
  end if;

  v_ref := nullif(trim(coalesce(p_signing_secret_ref, '')), '');
  if v_ref is not null and not agentsync.is_secret_reference(v_ref) then
    return jsonb_build_object('ok', false, 'error', 'SECRET_VALUE_NOT_A_REFERENCE');
  end if;

  -- An enabled endpoint with no signing secret accepts or sends unauthenticated
  -- traffic. Refuse it rather than let it look configured.
  if p_enabled and v_ref is null then
    return jsonb_build_object('ok', false, 'error', 'SIGNING_SECRET_REQUIRED');
  end if;

  if p_replay_window_seconds < 30 or p_replay_window_seconds > 3600 then
    return jsonb_build_object('ok', false, 'error', 'REPLAY_WINDOW_OUT_OF_RANGE');
  end if;

  insert into agentsync.webhook_endpoints as w (
    tenant_id, direction, path, note, signing_secret_ref,
    replay_window_seconds, enabled
  ) values (
    v_tenant, v_dir, trim(p_path), nullif(trim(coalesce(p_note, '')), ''),
    v_ref, p_replay_window_seconds, p_enabled
  )
  on conflict (tenant_id, path) do update set
    direction = excluded.direction,
    note = excluded.note,
    signing_secret_ref = excluded.signing_secret_ref,
    replay_window_seconds = excluded.replay_window_seconds,
    enabled = excluded.enabled;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function agentsync.delete_webhook_endpoint(
  p_user_id uuid, p_tenant_slug text, p_path text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  delete from agentsync.webhook_endpoints where tenant_id = v_tenant and path = p_path;
  return jsonb_build_object('ok', true);
end;
$$;

/* ---- secret references ------------------------------------------------ */

create unique index if not exists secret_references_tenant_reference_key
  on agentsync.secret_references (tenant_id, reference);

create or replace function agentsync.upsert_secret_reference(
  p_user_id uuid,
  p_tenant_slug text,
  p_reference text,
  p_used_by text default null,
  p_rotation_days integer default 90,
  p_revoked boolean default false,
  p_mark_rotated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_tenant uuid;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  if not agentsync.is_secret_reference(p_reference) then
    return jsonb_build_object('ok', false, 'error', 'SECRET_VALUE_NOT_A_REFERENCE');
  end if;

  if p_rotation_days < 1 or p_rotation_days > 730 then
    return jsonb_build_object('ok', false, 'error', 'ROTATION_DAYS_OUT_OF_RANGE');
  end if;

  insert into agentsync.secret_references as s (
    tenant_id, reference, used_by, rotated_at, rotation_days, revoked
  ) values (
    v_tenant, trim(p_reference), nullif(trim(coalesce(p_used_by, '')), ''),
    case when p_mark_rotated then now() else null end,
    p_rotation_days, p_revoked
  )
  on conflict (tenant_id, reference) do update set
    used_by = excluded.used_by,
    rotation_days = excluded.rotation_days,
    revoked = excluded.revoked,
    -- Only a rotation moves the date. Editing the row must not claim the
    -- secret was rotated when it was not.
    rotated_at = case when p_mark_rotated then now() else s.rotated_at end;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function agentsync.delete_secret_reference(
  p_user_id uuid, p_tenant_slug text, p_reference text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_used integer;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  -- Removing a reference something still points at would leave a connection
  -- naming a secret the platform no longer knows about.
  select count(*) into v_used from (
    select private_key_reference r from agentsync.github_app_installations where tenant_id = v_tenant
    union all select webhook_secret_reference from agentsync.github_app_installations where tenant_id = v_tenant
    union all select api_token_reference from agentsync.deployment_providers where tenant_id = v_tenant
    union all select key_reference from agentsync.ai_provider_credentials where tenant_id = v_tenant
    union all select signing_secret_ref from agentsync.webhook_endpoints where tenant_id = v_tenant
  ) refs where refs.r = p_reference;

  if v_used > 0 then
    return jsonb_build_object('ok', false, 'error', 'REFERENCE_IN_USE', 'detail', v_used::text);
  end if;

  delete from agentsync.secret_references where tenant_id = v_tenant and reference = p_reference;
  return jsonb_build_object('ok', true);
end;
$$;

/* ---- public wrappers, service_role only ------------------------------- */

create or replace function public.agentsync_upsert_ai_credential(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$
  select agentsync.upsert_ai_credential(
    (payload->>'user_id')::uuid, payload->>'tenant_slug', payload->>'provider',
    payload->>'model', payload->>'key_reference', payload->>'failover_triggers',
    coalesce((payload->>'failover_requires_optin')::boolean, true),
    nullif(payload->>'monthly_cap','')::numeric,
    coalesce((payload->>'hard_stop_at_cap')::boolean, true)
  );
$$;

create or replace function public.agentsync_delete_ai_credential(
  p_user_id uuid, p_tenant_slug text, p_provider text
) returns jsonb language sql security definer set search_path = ''
as $$ select agentsync.delete_ai_credential(p_user_id, p_tenant_slug, p_provider); $$;

create or replace function public.agentsync_upsert_webhook_endpoint(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$
  select agentsync.upsert_webhook_endpoint(
    (payload->>'user_id')::uuid, payload->>'tenant_slug', payload->>'direction',
    payload->>'path', payload->>'note', payload->>'signing_secret_ref',
    coalesce((payload->>'replay_window_seconds')::integer, 300),
    coalesce((payload->>'enabled')::boolean, true)
  );
$$;

create or replace function public.agentsync_delete_webhook_endpoint(
  p_user_id uuid, p_tenant_slug text, p_path text
) returns jsonb language sql security definer set search_path = ''
as $$ select agentsync.delete_webhook_endpoint(p_user_id, p_tenant_slug, p_path); $$;

create or replace function public.agentsync_upsert_secret_reference(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$
  select agentsync.upsert_secret_reference(
    (payload->>'user_id')::uuid, payload->>'tenant_slug', payload->>'reference',
    payload->>'used_by',
    coalesce((payload->>'rotation_days')::integer, 90),
    coalesce((payload->>'revoked')::boolean, false),
    coalesce((payload->>'mark_rotated')::boolean, false)
  );
$$;

create or replace function public.agentsync_delete_secret_reference(
  p_user_id uuid, p_tenant_slug text, p_reference text
) returns jsonb language sql security definer set search_path = ''
as $$ select agentsync.delete_secret_reference(p_user_id, p_tenant_slug, p_reference); $$;

revoke all on function public.agentsync_upsert_ai_credential(jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_delete_ai_credential(uuid, text, text) from public, anon, authenticated;
revoke all on function public.agentsync_upsert_webhook_endpoint(jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_delete_webhook_endpoint(uuid, text, text) from public, anon, authenticated;
revoke all on function public.agentsync_upsert_secret_reference(jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_delete_secret_reference(uuid, text, text) from public, anon, authenticated;
revoke all on function agentsync.configurable_tenant(uuid, text) from public, anon, authenticated;

grant execute on function public.agentsync_upsert_ai_credential(jsonb) to service_role;
grant execute on function public.agentsync_delete_ai_credential(uuid, text, text) to service_role;
grant execute on function public.agentsync_upsert_webhook_endpoint(jsonb) to service_role;
grant execute on function public.agentsync_delete_webhook_endpoint(uuid, text, text) to service_role;
grant execute on function public.agentsync_upsert_secret_reference(jsonb) to service_role;
grant execute on function public.agentsync_delete_secret_reference(uuid, text, text) to service_role;
grant execute on function agentsync.configurable_tenant(uuid, text) to service_role;

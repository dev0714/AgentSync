-- Authenticating a submitting system.
--
-- The plaintext key is shown exactly once, at issue. Only a hash is stored, so
-- a database leak does not yield working keys. Verification is by prefix lookup
-- then constant-time hash comparison, so the query cost doesn't depend on the
-- secret.

create or replace function agentsync.issue_source_system_key(
  p_tenant_id uuid,
  p_name text,
  p_ip_allowlist text[] default '{}',
  p_rate_limit_per_minute integer default 60,
  p_state agentsync.source_state default 'ACTIVE',
  p_live boolean default true
)
returns table (source_system_id uuid, api_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_prefix text;
  v_key text;
  v_id uuid;
begin
  -- 32 random bytes, base64url, prefixed so a leaked key is identifiable
  v_secret := replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
  v_secret := replace(v_secret, '=', '');
  v_prefix := case when p_live then 'ask_live_' else 'ask_test_' end;
  v_key := v_prefix || v_secret;

  insert into agentsync.source_systems (
    tenant_id, name, api_key_prefix, api_key_hash,
    ip_allowlist, rate_limit_per_minute, state
  ) values (
    p_tenant_id, p_name,
    -- stored prefix is what the portal displays: ask_live_9f3c…
    v_prefix || left(v_secret, 4),
    extensions.crypt(v_key, extensions.gen_salt('bf', 12)),
    p_ip_allowlist, p_rate_limit_per_minute, p_state
  ) returning id into v_id;

  return query select v_id, v_key;
end;
$$;

-- Returns the source system for a presented key, or nothing. Also enforces the
-- IP allowlist and the per-minute rate limit, so a caller cannot forget either.
create or replace function agentsync.authenticate_source(
  p_api_key text,
  p_ip inet default null
)
returns table (
  source_system_id uuid,
  tenant_id uuid,
  name text,
  rate_limited boolean,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  s agentsync.source_systems;
  v_prefix text;
  v_recent integer;
begin
  if p_api_key is null or length(p_api_key) < 16 then
    return query select null::uuid, null::uuid, null::text, false, 'INVALID_API_KEY';
    return;
  end if;

  -- narrow by stored prefix, then verify the hash
  v_prefix := left(p_api_key, position('_' in substr(p_api_key, 5)) + 8);
  for s in
    select * from agentsync.source_systems
     where api_key_prefix = left(p_api_key, length(api_key_prefix))
  loop
    if s.api_key_hash = extensions.crypt(p_api_key, s.api_key_hash) then
      if s.state = 'DISABLED' then
        return query select s.id, s.tenant_id, s.name, false, 'SOURCE_DISABLED';
        return;
      end if;

      -- IP allowlist: empty means any
      if array_length(s.ip_allowlist, 1) is not null
         and p_ip is not null
         and not exists (
           select 1 from unnest(s.ip_allowlist) a
            where a = 'any' or p_ip <<= a::inet
         ) then
        return query select s.id, s.tenant_id, s.name, false, 'IP_NOT_ALLOWED';
        return;
      end if;

      select count(*) into v_recent
        from agentsync.agent_tasks
       where source_system_id = s.id and created_at > now() - interval '1 minute';

      if v_recent >= s.rate_limit_per_minute then
        return query select s.id, s.tenant_id, s.name, true, 'RATE_LIMITED';
        return;
      end if;

      update agentsync.source_systems set last_used_at = now() where id = s.id;
      return query select s.id, s.tenant_id, s.name, false, null::text;
      return;
    end if;
  end loop;

  return query select null::uuid, null::uuid, null::text, false, 'INVALID_API_KEY';
end;
$$;

-- ---------------------------------------------------------------------------
-- public wrappers, service_role only
-- ---------------------------------------------------------------------------

create or replace function public.agentsync_submit_task(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth record;
  v_result record;
begin
  select * into v_auth
    from agentsync.authenticate_source(
      payload->>'api_key',
      nullif(payload->>'ip', '')::inet
    );

  if v_auth.reason is not null then
    return jsonb_build_object('ok', false, 'error', v_auth.reason);
  end if;

  select * into v_result
    from agentsync.submit_task(
      v_auth.tenant_id,
      (payload->>'project_id')::uuid,
      v_auth.source_system_id,
      payload->>'idempotency_key',
      payload->>'title',
      payload->>'description',
      payload->>'external_reference',
      coalesce(nullif(payload->>'request_type',''), 'code_change')::agentsync.request_type,
      coalesce(nullif(payload->>'priority',''), 'normal')::agentsync.task_priority,
      coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(
           coalesce(payload->'acceptance_criteria', '[]'::jsonb))),
        '{}'::text[]
      ),
      payload->'requested_by',
      nullif(payload->>'callback_url','')
    );

  return jsonb_build_object(
    'ok', true,
    'task_id', v_result.task_id,
    'correlation_id', v_result.correlation_id,
    'status', v_result.status,
    'created', v_result.created
  );
end;
$$;

create or replace function public.agentsync_issue_source_key(
  p_tenant_slug text,
  p_name text,
  p_ip_allowlist text[] default '{}',
  p_rate_limit_per_minute integer default 60,
  p_live boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_row record;
begin
  select id into v_tenant from agentsync.tenants where slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'no such tenant %', p_tenant_slug;
  end if;
  select * into v_row from agentsync.issue_source_system_key(
    v_tenant, p_name, p_ip_allowlist, p_rate_limit_per_minute, 'ACTIVE', p_live);
  return jsonb_build_object('source_system_id', v_row.source_system_id, 'api_key', v_row.api_key);
end;
$$;

create or replace function public.agentsync_claim_next_task(
  p_worker_id text,
  p_lease_seconds integer default 1800
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(to_jsonb(c), 'null'::jsonb)
  from agentsync.claim_next_task(p_worker_id, p_lease_seconds) c;
$$;

create or replace function public.agentsync_transition_task(
  p_task_id uuid,
  p_to text,
  p_actor text default 'system',
  p_message text default null,
  p_worker_id text default null
)
returns text
language sql
security definer
set search_path = ''
as $$
  select agentsync.transition_task(
    p_task_id, p_to::agentsync.task_status, p_actor, p_message, '{}'::jsonb, p_worker_id
  )::text;
$$;

create or replace function public.agentsync_heartbeat_task(
  p_task_id uuid, p_worker_id text, p_lease_seconds integer default 1800
)
returns boolean
language sql security definer set search_path = ''
as $$ select agentsync.heartbeat_task(p_task_id, p_worker_id, p_lease_seconds); $$;

create or replace function public.agentsync_reclaim_expired_tasks()
returns integer
language sql security definer set search_path = ''
as $$ select agentsync.reclaim_expired_tasks(); $$;

revoke all on function public.agentsync_submit_task(jsonb) from public, anon, authenticated;
revoke all on function public.agentsync_issue_source_key(text, text, text[], integer, boolean) from public, anon, authenticated;
revoke all on function public.agentsync_claim_next_task(text, integer) from public, anon, authenticated;
revoke all on function public.agentsync_transition_task(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.agentsync_heartbeat_task(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.agentsync_reclaim_expired_tasks() from public, anon, authenticated;

grant execute on function public.agentsync_submit_task(jsonb) to service_role;
grant execute on function public.agentsync_issue_source_key(text, text, text[], integer, boolean) to service_role;
grant execute on function public.agentsync_claim_next_task(text, integer) to service_role;
grant execute on function public.agentsync_transition_task(uuid, text, text, text, text) to service_role;
grant execute on function public.agentsync_heartbeat_task(uuid, text, integer) to service_role;
grant execute on function public.agentsync_reclaim_expired_tasks() to service_role;

revoke all on function agentsync.issue_source_system_key(uuid, text, text[], integer, agentsync.source_state, boolean) from public, anon, authenticated;
revoke all on function agentsync.authenticate_source(text, inet) from public, anon, authenticated;
grant execute on function agentsync.issue_source_system_key(uuid, text, text[], integer, agentsync.source_state, boolean) to service_role;
grant execute on function agentsync.authenticate_source(text, inet) to service_role;

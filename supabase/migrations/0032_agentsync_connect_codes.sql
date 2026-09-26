-- One-click connection for a source system (LeadSync and the like).
--
-- The source sends a person here; they pick a tenant and approve. AgentSync
-- finds or creates the source (reconnecting rotates the key, so client
-- mappings survive), seals the new key and hands the browser a one-time code.
-- The source's server exchanges that code — with the verifier only it holds —
-- for the key and the callback secret. No secret ever travels in a URL.

create table agentsync.source_connect_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  source_system_id uuid not null references agentsync.source_systems (id) on delete cascade,
  challenge text not null,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  callback_secret_ref text not null,
  created_by uuid,
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table agentsync.source_connect_codes enable row level security;

/* ---- tenants this user may connect a source to ------------------------- */

create or replace function public.agentsync_configurable_tenants(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name) order by lower(t.name)), '[]'::jsonb)
    from agentsync.tenants t
   where agentsync.configurable_tenant(p_user_id, t.slug) is not null;
$$;

/* ---- a new key for an existing source ----------------------------------- */

create or replace function agentsync.rotate_source_key(p_source_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_secret text;
  v_key text;
begin
  v_secret := replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
  v_secret := replace(v_secret, '=', '');
  v_key := 'ask_live_' || v_secret;
  update agentsync.source_systems
     set api_key_prefix = 'ask_live_' || left(v_secret, 4),
         api_key_hash = extensions.crypt(v_key, extensions.gen_salt('bf', 12)),
         state = 'ACTIVE'
   where id = p_source_id;
  if not found then
    raise exception 'source % not found', p_source_id;
  end if;
  return v_key;
end;
$$;

/* ---- approve: find or create the source, return its (new) key ---------- */

create or replace function public.agentsync_portal_connect_source(
  p_user_id uuid, p_tenant_slug text, p_name text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_source uuid;
  v_key text;
  v_name text := left(trim(coalesce(p_name, '')), 120);
  v_row record;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED');
  end if;

  select s.id into v_source from agentsync.source_systems s
   where s.tenant_id = v_tenant and s.name = v_name;

  if v_source is not null then
    v_key := agentsync.rotate_source_key(v_source);
    return jsonb_build_object('ok', true, 'source_system_id', v_source, 'api_key', v_key,
                              'reconnected', true, 'tenant_name', (select name from agentsync.tenants where id = v_tenant));
  end if;

  select * into v_row from agentsync.issue_source_system_key(v_tenant, v_name);
  return jsonb_build_object('ok', true, 'source_system_id', v_row.source_system_id, 'api_key', v_row.api_key,
                            'reconnected', false, 'tenant_name', (select name from agentsync.tenants where id = v_tenant));
end;
$$;

/* ---- the one-time code --------------------------------------------------- */

create or replace function public.agentsync_connect_code_put(
  p_user_id uuid, p_source_id uuid, p_code_hash text, p_challenge text,
  p_ciphertext text, p_iv text, p_tag text, p_callback_secret_ref text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select s.tenant_id into v_tenant from agentsync.source_systems s where s.id = p_source_id;
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if agentsync.configurable_tenant(p_user_id, (select slug from agentsync.tenants where id = v_tenant)) is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  -- Old, unused codes for this source are void once a new one exists.
  delete from agentsync.source_connect_codes c
   where c.source_system_id = p_source_id or c.expires_at < now() - interval '1 day';

  insert into agentsync.source_connect_codes
    (code_hash, tenant_id, source_system_id, challenge, ciphertext, iv, tag, callback_secret_ref, created_by)
  values
    (p_code_hash, v_tenant, p_source_id, p_challenge, p_ciphertext, p_iv, p_tag, p_callback_secret_ref, p_user_id);
  return jsonb_build_object('ok', true);
end;
$$;

-- Consumes the code: it works once, only before it expires, and only with the
-- challenge the verifier hashes to — so a code seen in a browser is useless alone.
create or replace function public.agentsync_connect_code_take(p_code_hash text, p_challenge text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row agentsync.source_connect_codes;
begin
  update agentsync.source_connect_codes c
     set used_at = now()
   where c.code_hash = p_code_hash and c.challenge = p_challenge
     and c.used_at is null and c.expires_at > now()
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  return jsonb_build_object(
    'ok', true,
    'source_system_id', v_row.source_system_id,
    'ciphertext', v_row.ciphertext, 'iv', v_row.iv, 'tag', v_row.tag,
    'callback_secret_ref', v_row.callback_secret_ref,
    'tenant_name', (select t.name from agentsync.tenants t where t.id = v_row.tenant_id),
    'tenant_slug', (select t.slug from agentsync.tenants t where t.id = v_row.tenant_id)
  );
end;
$$;

-- The sealed key is only needed until the exchange; wipe it once used.
create or replace function public.agentsync_connect_code_wipe(p_code_hash text)
returns void
language sql security definer set search_path = ''
as $$
  update agentsync.source_connect_codes set ciphertext = '', iv = '', tag = ''
   where code_hash = p_code_hash and used_at is not null;
$$;

/* ---- the source disconnects itself --------------------------------------- */

create or replace function public.agentsync_source_revoke(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_auth record;
begin
  select * into v_auth
    from agentsync.authenticate_source(payload->>'api_key', nullif(payload->>'ip', '')::inet);
  if v_auth.source_system_id is null or v_auth.reason in ('INVALID_API_KEY', 'SOURCE_DISABLED') then
    return jsonb_build_object('ok', false, 'error', coalesce(v_auth.reason, 'INVALID_API_KEY'));
  end if;
  update agentsync.source_systems set state = 'DISABLED' where id = v_auth.source_system_id;
  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.agentsync_configurable_tenants(uuid)',
    'agentsync.rotate_source_key(uuid)',
    'public.agentsync_portal_connect_source(uuid, text, text)',
    'public.agentsync_connect_code_put(uuid, uuid, text, text, text, text, text, text)',
    'public.agentsync_connect_code_take(text, text)',
    'public.agentsync_connect_code_wipe(text)',
    'public.agentsync_source_revoke(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

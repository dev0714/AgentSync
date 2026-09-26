-- Secrets AgentSync is handed rather than given a reference to.
--
-- The one-click GitHub connection receives the App's private key from GitHub
-- exactly once; there is no environment variable to point at. It is stored
-- here encrypted (AES-256-GCM) with a key that exists only in the deployment
-- environment (AGENTSYNC_ENCRYPTION_KEY), so the database alone never yields
-- it. Connections refer to it as `db:<id>`, which still satisfies
-- is_secret_reference — everywhere else keeps holding references, not values.

create table agentsync.encrypted_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references agentsync.tenants (id) on delete cascade,
  purpose text not null,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  created_at timestamptz not null default now()
);

alter table agentsync.encrypted_secrets enable row level security;
-- No policies: only the security-definer functions below can read or write it.

create or replace function public.agentsync_store_secret(
  p_user_id uuid,
  p_tenant_slug text,
  p_purpose text,
  p_ciphertext text,
  p_iv text,
  p_tag text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_ref text;
begin
  v_tenant := agentsync.configurable_tenant(p_user_id, p_tenant_slug);
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;

  insert into agentsync.encrypted_secrets (tenant_id, purpose, ciphertext, iv, tag)
  values (v_tenant, p_purpose, p_ciphertext, p_iv, p_tag)
  returning id into v_id;

  v_ref := 'db:' || v_id::text;
  insert into agentsync.secret_references (tenant_id, reference, used_by, rotated_at)
  values (v_tenant, v_ref, p_purpose, now())
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'reference', v_ref);
end;
$$;

create or replace function public.agentsync_read_secret(p_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('ciphertext', s.ciphertext, 'iv', s.iv, 'tag', s.tag)
    from agentsync.encrypted_secrets s
   where s.id = p_id
     and not exists (
       select 1 from agentsync.secret_references r
        where r.reference = 'db:' || s.id::text and r.revoked
     );
$$;

revoke all on function public.agentsync_store_secret(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.agentsync_read_secret(uuid) from public, anon, authenticated;
grant execute on function public.agentsync_store_secret(uuid, text, text, text, text, text) to service_role;
grant execute on function public.agentsync_read_secret(uuid) to service_role;

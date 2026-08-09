-- The OUT parameter `source_system_id` shadowed agent_tasks.source_system_id in
-- the rate-limit subquery, so every authentication attempt raised
-- "column reference is ambiguous" instead of authenticating. Qualify the
-- column, and count against a table alias so the two can never collide again.

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
  v_recent integer;
begin
  if p_api_key is null or length(p_api_key) < 16 then
    return query select null::uuid, null::uuid, null::text, false, 'INVALID_API_KEY';
    return;
  end if;

  for s in
    select * from agentsync.source_systems ss
     where ss.api_key_prefix = left(p_api_key, length(ss.api_key_prefix))
  loop
    if s.api_key_hash = extensions.crypt(p_api_key, s.api_key_hash) then
      if s.state = 'DISABLED' then
        return query select s.id, s.tenant_id, s.name, false, 'SOURCE_DISABLED';
        return;
      end if;

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
        from agentsync.agent_tasks tk
       where tk.source_system_id = s.id
         and tk.created_at > now() - interval '1 minute';

      if v_recent >= s.rate_limit_per_minute then
        return query select s.id, s.tenant_id, s.name, true, 'RATE_LIMITED';
        return;
      end if;

      update agentsync.source_systems ss set last_used_at = now() where ss.id = s.id;
      return query select s.id, s.tenant_id, s.name, false, null::text;
      return;
    end if;
  end loop;

  return query select null::uuid, null::uuid, null::text, false, 'INVALID_API_KEY';
end;
$$;

revoke all on function agentsync.authenticate_source(text, inet) from public, anon, authenticated;
grant execute on function agentsync.authenticate_source(text, inet) to service_role;

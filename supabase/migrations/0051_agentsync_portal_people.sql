-- The names behind the audit log's actors: the tenant's members, and any
-- other person (a super admin) who has acted on its tasks.

create or replace function public.agentsync_portal_people(p_user_id uuid, p_tenant_slug text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid := agentsync.readable_tenant(p_user_id, p_tenant_slug);
begin
  if v_tenant is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', u.email,
               'name', coalesce(nullif(trim(u.display_name), ''), split_part(u.email, '@', 1)),
               'role', u.role::text) order by u.email)
        from agentsync.users u
       where exists (select 1 from agentsync.tenant_users tu where tu.user_id = u.id and tu.tenant_id = v_tenant)
          or exists (select 1 from agentsync.task_events e
                      where e.tenant_id = v_tenant and e.actor = 'user:' || u.email)), '[]'::jsonb));
end;
$$;
revoke all on function public.agentsync_portal_people(uuid, text) from public, anon, authenticated;
grant execute on function public.agentsync_portal_people(uuid, text) to service_role;

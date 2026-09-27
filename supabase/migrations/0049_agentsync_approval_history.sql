-- The Approvals screen's history: every decision a person has made on the
-- tenant's tasks, newest first — who decided, what, when, and what they said.

create or replace function public.agentsync_portal_approval_history(
  p_user_id uuid, p_tenant_slug text, p_limit integer default 200
)
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
    'history', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.decided_at desc)
        from (
          select ap.id, ap.task_id,
                 coalesce(tk.external_reference, left(tk.correlation_id::text, 8)) as reference,
                 tk.title, tk.status::text as status,
                 ap.gate::text as gate, ap.decision::text as decision,
                 ap.decided_by_email, ap.decided_by_role::text as decided_by_role,
                 ap.comments, ap.requested_at, ap.decided_at,
                 pr.name as project
            from agentsync.task_approvals ap
            join agentsync.agent_tasks tk on tk.id = ap.task_id
            left join agentsync.projects pr on pr.id = tk.project_id
           where ap.tenant_id = v_tenant and ap.decision <> 'pending'
           order by ap.decided_at desc nulls last
           limit greatest(1, least(coalesce(p_limit, 200), 500))
        ) h), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.agentsync_portal_approval_history(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.agentsync_portal_approval_history(uuid, text, integer) to service_role;

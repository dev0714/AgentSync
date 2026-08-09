-- What the portal reads.
--
-- The portal has no fixtures behind it, so every screen needs its rows from
-- here. Two functions rather than twenty round trips: one for the tenant
-- overview every screen draws from, one for a single task.
--
-- Both take the caller's user id and check membership themselves. They run as
-- SECURITY DEFINER because PostgREST cannot set `agentsync.user_id` per
-- request, so RLS would see no identity — the membership check below is what
-- replaces it, and it is the only thing standing between one tenant and
-- another. A caller that is not a member gets `{"ok": false}`, never a
-- partially-filled payload.

create or replace function agentsync.portal_overview(
  p_user_id uuid,
  p_tenant_slug text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_platform_role agentsync.user_role;
  v_tenant agentsync.tenants;
  v_role agentsync.user_role;
  v_tenants jsonb;
begin
  select u.role into v_platform_role
    from agentsync.users u
   where u.id = p_user_id and u.state = 'ACTIVE';

  if v_platform_role is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_USER');
  end if;

  -- Every tenant this account may switch to. A platform SUPER_ADMIN sees all
  -- of them; everyone else sees only where they hold a membership.
  select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb) into v_tenants
    from (
      select jsonb_build_object(
               'slug', tn.slug,
               'name', tn.name,
               'plan', tn.plan,
               'status', tn.status,
               'role', coalesce(tu.role::text, v_platform_role::text),
               'project_count', (select count(*) from agentsync.projects p where p.tenant_id = tn.id),
               'task_count', (select count(*) from agentsync.agent_tasks a where a.tenant_id = tn.id)
             ) as t
        from agentsync.tenants tn
        left join agentsync.tenant_users tu
               on tu.tenant_id = tn.id and tu.user_id = p_user_id
       where v_platform_role = 'SUPER_ADMIN' or tu.id is not null
    ) s;

  -- The requested tenant, or the first one available.
  select tn.* into v_tenant
    from agentsync.tenants tn
    left join agentsync.tenant_users tu
           on tu.tenant_id = tn.id and tu.user_id = p_user_id
   where (p_tenant_slug is null or tn.slug = p_tenant_slug)
     and (v_platform_role = 'SUPER_ADMIN' or tu.id is not null)
   order by tn.name
   limit 1;

  if v_tenant.id is null then
    -- Authenticated, but not a member of anything yet. An empty portal is the
    -- honest answer; inventing a tenant would not be.
    return jsonb_build_object(
      'ok', true, 'tenant', null, 'tenants', v_tenants,
      'platform_role', v_platform_role
    );
  end if;

  select coalesce(tu.role, v_platform_role) into v_role
    from agentsync.tenant_users tu
   where tu.tenant_id = v_tenant.id and tu.user_id = p_user_id;
  v_role := coalesce(v_role, v_platform_role);

  return jsonb_build_object(
    'ok', true,
    'platform_role', v_platform_role,
    'role', v_role,
    'tenants', v_tenants,

    'tenant', jsonb_build_object(
      'slug', v_tenant.slug,
      'name', v_tenant.name,
      'plan', v_tenant.plan,
      'status', v_tenant.status,
      'primary_contact', v_tenant.primary_contact,
      'billing_email', v_tenant.billing_email,
      'data_region', v_tenant.data_region,
      'notes', v_tenant.notes,
      'settings', coalesce(v_tenant.settings, '{}'::jsonb),
      'trial_ends_at', v_tenant.trial_ends_at,
      'created_at', v_tenant.created_at
    ),

    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'display_name', tu.display_name,
               'email', tu.email,
               'role', tu.role,
               'state', tu.state,
               'last_active_at', tu.last_active_at
             ) order by tu.display_name), '[]'::jsonb)
        from agentsync.tenant_users tu
       where tu.tenant_id = v_tenant.id
    ),

    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'slug', p.slug,
               'enabled', p.enabled,
               'plan_approval_required', p.plan_approval_required,
               'merge_approval_required', p.merge_approval_required,
               'production_requires_approval', p.production_requires_approval,
               'agent_may_merge_own_pr', p.agent_may_merge_own_pr,
               'direct_push_to_default', p.direct_push_to_default,
               'callback_url', p.callback_url,
               'callback_signing_secret_ref', p.callback_signing_secret_ref,
               'rollback_policy', p.rollback_policy,
               'monthly_ai_budget', p.monthly_ai_budget,
               'repository', (select to_jsonb(r) from agentsync.project_repositories r where r.project_id = p.id),
               'runtime', (select to_jsonb(rc) from agentsync.project_runtime_configs rc where rc.project_id = p.id),
               'ai', (select to_jsonb(ac) from agentsync.project_ai_configs ac where ac.project_id = p.id),
               'spend', (select coalesce(sum(u.cost), 0) from agentsync.task_ai_usage u
                          join agentsync.agent_tasks t on t.id = u.task_id
                         where t.project_id = p.id
                           and u.created_at >= date_trunc('month', now()))
             ) order by p.name), '[]'::jsonb)
        from agentsync.projects p
       where p.tenant_id = v_tenant.id
    ),

    'tasks', (
      select coalesce(jsonb_agg(t order by t->>'updated_at' desc), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', tk.id,
                   'reference', coalesce(tk.external_reference, left(tk.correlation_id::text, 8)),
                   'title', tk.title,
                   'status', tk.status,
                   'priority', tk.priority,
                   'request_type', tk.request_type,
                   'progress_percent', coalesce(tk.progress_percent, 0),
                   'branch_name', tk.branch_name,
                   'project', pr.name,
                   'updated_at', tk.updated_at,
                   'created_at', tk.created_at,
                   'completed_at', tk.completed_at,
                   'error_code', tk.error_code
                 ) as t
            from agentsync.agent_tasks tk
            left join agentsync.projects pr on pr.id = tk.project_id
           where tk.tenant_id = v_tenant.id
           order by tk.updated_at desc
           limit 200
        ) s
    ),

    'metrics', (
      select jsonb_build_object(
               'total', count(*),
               'in_flight', count(*) filter (
                 where tk.status in ('received','validating','queued','analysing','planning',
                                     'implementing','testing','creating_pull_request',
                                     'deploying_preview','deploying_production')),
               'awaiting_approval', count(*) filter (where tk.status::text like 'awaiting%'),
               'needs_information', count(*) filter (where tk.status = 'needs_information'),
               'completed_7d', count(*) filter (
                 where tk.status = 'completed' and tk.completed_at > now() - interval '7 days'),
               'failed_7d', count(*) filter (
                 where tk.status = 'failed' and tk.updated_at > now() - interval '7 days'),
               'median_minutes', (
                 select round(percentile_cont(0.5) within group (
                   order by extract(epoch from (c.completed_at - c.created_at)) / 60)::numeric, 1)
                   from agentsync.agent_tasks c
                  where c.tenant_id = v_tenant.id and c.completed_at is not null)
             )
        from agentsync.agent_tasks tk
       where tk.tenant_id = v_tenant.id
    ),

    'approvals', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ap.id,
               'task_id', ap.task_id,
               'reference', coalesce(tk.external_reference, left(tk.correlation_id::text, 8)),
               'title', tk.title,
               'gate', ap.gate,
               'requested_at', ap.requested_at,
               'project', pr.name,
               'status', tk.status
             ) order by ap.requested_at), '[]'::jsonb)
        from agentsync.task_approvals ap
        join agentsync.agent_tasks tk on tk.id = ap.task_id
        left join agentsync.projects pr on pr.id = tk.project_id
       where ap.tenant_id = v_tenant.id and ap.decision = 'pending'
    ),

    'deployments', (
      select coalesce(jsonb_agg(d order by d->>'started_at' desc), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', dp.id,
                   'environment', dp.environment,
                   'url', dp.url,
                   'branch', dp.branch,
                   'commit_sha', dp.commit_sha,
                   'status', dp.status,
                   'provider', dp.provider,
                   'build_duration_seconds', dp.build_duration_seconds,
                   'started_at', dp.started_at,
                   'finished_at', dp.finished_at
                 ) as d
            from agentsync.deployments dp
           where dp.tenant_id = v_tenant.id
           order by dp.started_at desc nulls last
           limit 50
        ) s
    ),

    'audit', (
      select coalesce(jsonb_agg(e order by (e->>'id')::bigint desc), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', ev.id,
                   'event_type', ev.event_type,
                   'message', ev.message,
                   'actor', ev.actor,
                   'task_id', ev.task_id,
                   'created_at', ev.created_at
                 ) as e
            from agentsync.task_events ev
           where ev.tenant_id = v_tenant.id
           order by ev.id desc
           limit 100
        ) s
    ),

    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ss.id,
               'name', ss.name,
               'api_key_prefix', ss.api_key_prefix,
               'ip_allowlist', coalesce(ss.ip_allowlist, '{}'),
               'rate_limit_per_minute', ss.rate_limit_per_minute,
               'state', ss.state,
               'last_used_at', ss.last_used_at,
               'task_count', (select count(*) from agentsync.agent_tasks a where a.source_system_id = ss.id)
             ) order by ss.name), '[]'::jsonb)
        from agentsync.source_systems ss
       where ss.tenant_id = v_tenant.id
    ),

    'agents', (
      select coalesce(jsonb_agg(a order by (a->>'stage_order')::int), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'id', ad.id,
                   'key', ad.key,
                   'display_name', ad.display_name,
                   'stage_order', ad.stage_order,
                   'purpose', ad.purpose,
                   'request_types', coalesce(ad.request_types, '{}'),
                   'enabled', ad.enabled,
                   'optional_stage', ad.optional_stage,
                   'terminal_stage', ad.terminal_stage,
                   'blocking', ad.blocking,
                   'veto_power', ad.veto_power,
                   'may_self_approve', ad.may_self_approve,
                   'requires_approved_plan', ad.requires_approved_plan,
                   'system_prompt', ad.system_prompt,
                   'inputs', coalesce(ad.inputs, '[]'::jsonb),
                   'outputs', coalesce(ad.outputs, '[]'::jsonb),
                   'checks', coalesce(ad.checks, '[]'::jsonb),
                   'limits', coalesce(ad.limits, '{}'::jsonb),
                   'platform_default', ad.tenant_id is null,
                   'ai', (select to_jsonb(ai) from agentsync.agent_ai_configs ai
                           where ai.agent_definition_id = ad.id),
                   'tools', (select coalesce(jsonb_agg(jsonb_build_object(
                                      'tool_name', tl.tool_name,
                                      'scope', tl.scope,
                                      'grant_level', tl.grant_level
                                    ) order by tl.tool_name), '[]'::jsonb)
                               from agentsync.agent_tools tl
                              where tl.agent_definition_id = ad.id),
                   'templates', (select coalesce(jsonb_object_agg(tp.template_key, tp.template_value), '{}'::jsonb)
                                   from agentsync.agent_templates tp
                                  where tp.agent_definition_id = ad.id),
                   'runs', (select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb)
                              from (
                                select jsonb_build_object(
                                         'reference', coalesce(tk.external_reference, left(tk.correlation_id::text, 8)),
                                         'input_tokens', us.input_tokens,
                                         'output_tokens', us.output_tokens,
                                         'cost', us.cost,
                                         'duration_seconds', us.duration_seconds,
                                         'failover', us.failover,
                                         'model', us.model,
                                         'created_at', us.created_at
                                       ) as r
                                  from agentsync.task_ai_usage us
                                  join agentsync.agent_tasks tk on tk.id = us.task_id
                                 where us.agent_definition_id = ad.id
                                   and us.tenant_id = v_tenant.id
                                 order by us.created_at desc
                                 limit 20
                              ) rs)
                 ) as a
            from agentsync.agent_definitions ad
           where ad.tenant_id is null or ad.tenant_id = v_tenant.id
        ) s
    ),

    'usage', (
      select jsonb_build_object(
               'month_cost', coalesce(sum(u.cost) filter (
                 where u.created_at >= date_trunc('month', now())), 0),
               'month_input_tokens', coalesce(sum(u.input_tokens) filter (
                 where u.created_at >= date_trunc('month', now())), 0),
               'month_output_tokens', coalesce(sum(u.output_tokens) filter (
                 where u.created_at >= date_trunc('month', now())), 0),
               'failover_calls', coalesce(count(*) filter (where u.failover), 0),
               'budget', (select coalesce(sum(p.monthly_ai_budget), 0)
                            from agentsync.projects p where p.tenant_id = v_tenant.id)
             )
        from agentsync.task_ai_usage u
       where u.tenant_id = v_tenant.id
    ),

    'connections', jsonb_build_object(
      -- Only secret *references* are stored on these rows, never secret
      -- values, so the whole row is safe to hand to the portal.
      'github', (select to_jsonb(g) from agentsync.github_app_installations g
                  where g.tenant_id = v_tenant.id limit 1),
      'deployment', (select to_jsonb(d) from agentsync.deployment_providers d
                      where d.tenant_id = v_tenant.id limit 1),
      'ai', (select coalesce(jsonb_agg(to_jsonb(c) order by c.provider), '[]'::jsonb)
               from agentsync.ai_provider_credentials c where c.tenant_id = v_tenant.id),
      'secrets', (select coalesce(jsonb_agg(jsonb_build_object(
                           'reference', sr.reference,
                           'used_by', sr.used_by,
                           'rotated_at', sr.rotated_at,
                           'rotation_days', sr.rotation_days,
                           'revoked', sr.revoked
                         ) order by sr.reference), '[]'::jsonb)
                    from agentsync.secret_references sr where sr.tenant_id = v_tenant.id),
      'webhooks', (select coalesce(jsonb_agg(jsonb_build_object(
                            'direction', wh.direction,
                            'path', wh.path,
                            'note', wh.note,
                            'replay_window_seconds', wh.replay_window_seconds,
                            'enabled', wh.enabled
                          ) order by wh.path), '[]'::jsonb)
                     from agentsync.webhook_endpoints wh where wh.tenant_id = v_tenant.id)
    )
  );
end;
$$;

-- One task, with everything the detail screen shows.
create or replace function agentsync.portal_task(
  p_user_id uuid,
  p_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
  v_platform_role agentsync.user_role;
begin
  select u.role into v_platform_role
    from agentsync.users u where u.id = p_user_id and u.state = 'ACTIVE';
  if v_platform_role is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_USER');
  end if;

  select * into v_task from agentsync.agent_tasks where id = p_task_id;
  if v_task.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  -- The membership check RLS would otherwise make. Without it this function
  -- would hand any authenticated user any tenant's task.
  if v_platform_role <> 'SUPER_ADMIN' and not exists (
       select 1 from agentsync.tenant_users tu
        where tu.tenant_id = v_task.tenant_id and tu.user_id = p_user_id
     ) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'task', to_jsonb(v_task) - 'callback_url',
    'project', (select jsonb_build_object('name', p.name, 'slug', p.slug)
                  from agentsync.projects p where p.id = v_task.project_id),
    'source', (select ss.name from agentsync.source_systems ss where ss.id = v_task.source_system_id),
    'plan', (select to_jsonb(pl) from agentsync.task_plans pl
              where pl.task_id = v_task.id order by pl.version desc limit 1),
    'files', (select coalesce(jsonb_agg(to_jsonb(fc) order by fc.seq), '[]'::jsonb)
                from agentsync.task_file_changes fc where fc.task_id = v_task.id),
    'commands', (select coalesce(jsonb_agg(to_jsonb(cr) order by cr.created_at), '[]'::jsonb)
                   from agentsync.task_command_runs cr where cr.task_id = v_task.id),
    'review', (select to_jsonb(rv) from agentsync.task_reviews rv
                where rv.task_id = v_task.id order by rv.created_at desc limit 1),
    'report', (select to_jsonb(rp) from agentsync.task_reports rp
                where rp.task_id = v_task.id order by rp.created_at desc limit 1),
    'security_findings', (select coalesce(jsonb_agg(to_jsonb(sf) order by sf.created_at), '[]'::jsonb)
                            from agentsync.task_security_findings sf where sf.task_id = v_task.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', ev.id, 'event_type', ev.event_type, 'message', ev.message,
                        'actor', ev.actor, 'created_at', ev.created_at
                      ) order by ev.id), '[]'::jsonb)
                 from agentsync.task_events ev where ev.task_id = v_task.id),
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object(
                           'gate', ap.gate, 'decision', ap.decision,
                           'decided_by_email', ap.decided_by_email,
                           'decided_by_role', ap.decided_by_role,
                           'comments', ap.comments,
                           'requested_at', ap.requested_at, 'decided_at', ap.decided_at
                         ) order by ap.requested_at), '[]'::jsonb)
                    from agentsync.task_approvals ap where ap.task_id = v_task.id),
    'usage', (select jsonb_build_object(
                       'input_tokens', coalesce(sum(us.input_tokens), 0),
                       'output_tokens', coalesce(sum(us.output_tokens), 0),
                       'cost', coalesce(sum(us.cost), 0),
                       'calls', count(*))
                from agentsync.task_ai_usage us where us.task_id = v_task.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- public wrappers, service_role only
-- ---------------------------------------------------------------------------

create or replace function public.agentsync_portal_overview(
  p_user_id uuid, p_tenant_slug text default null
)
returns jsonb language sql stable security definer set search_path = ''
as $$ select agentsync.portal_overview(p_user_id, p_tenant_slug); $$;

create or replace function public.agentsync_portal_task(
  p_user_id uuid, p_task_id uuid
)
returns jsonb language sql stable security definer set search_path = ''
as $$ select agentsync.portal_task(p_user_id, p_task_id); $$;

revoke all on function public.agentsync_portal_overview(uuid, text) from public, anon, authenticated;
revoke all on function public.agentsync_portal_task(uuid, uuid) from public, anon, authenticated;
revoke all on function agentsync.portal_overview(uuid, text) from public, anon, authenticated;
revoke all on function agentsync.portal_task(uuid, uuid) from public, anon, authenticated;

grant execute on function public.agentsync_portal_overview(uuid, text) to service_role;
grant execute on function public.agentsync_portal_task(uuid, uuid) to service_role;
grant execute on function agentsync.portal_overview(uuid, text) to service_role;
grant execute on function agentsync.portal_task(uuid, uuid) to service_role;

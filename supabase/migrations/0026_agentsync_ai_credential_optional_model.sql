-- The model on an AI credential is optional: every agent takes its model from
-- its tier (agent_tier_models). A credential's model is only a fallback for an
-- agent with no tier slot.

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

  if not agentsync.is_secret_reference(p_key_reference) then
    return jsonb_build_object('ok', false, 'error', 'SECRET_VALUE_NOT_A_REFERENCE');
  end if;

  if p_monthly_cap is not null and p_monthly_cap <= 0 then
    return jsonb_build_object('ok', false, 'error', 'CAP_MUST_BE_POSITIVE');
  end if;

  if p_monthly_cap is null and not p_hard_stop_at_cap then
    return jsonb_build_object('ok', false, 'error', 'NO_CAP_TO_ENFORCE');
  end if;

  insert into agentsync.ai_provider_credentials as c (
    tenant_id, provider, model, key_reference, failover_triggers,
    failover_requires_optin, monthly_cap, hard_stop_at_cap
  ) values (
    v_tenant, p_provider::agentsync.ai_provider, nullif(trim(coalesce(p_model, '')), ''),
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

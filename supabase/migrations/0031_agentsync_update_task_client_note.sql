-- The worker can record the plain-language note for the requester.
create or replace function public.agentsync_update_task(p_task_id uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update agentsync.agent_tasks set
    branch_name = case when p_fields ? 'branch_name' then p_fields->>'branch_name' else branch_name end,
    commit_sha = case when p_fields ? 'commit_sha' then p_fields->>'commit_sha' else commit_sha end,
    pull_request_url = case when p_fields ? 'pull_request_url' then p_fields->>'pull_request_url' else pull_request_url end,
    pull_request_number = case when p_fields ? 'pull_request_number' then (p_fields->>'pull_request_number')::int else pull_request_number end,
    pull_request_body = case when p_fields ? 'pull_request_body' then p_fields->>'pull_request_body' else pull_request_body end,
    result_summary = case when p_fields ? 'result_summary' then p_fields->>'result_summary' else result_summary end,
    client_note = case when p_fields ? 'client_note' then p_fields->>'client_note' else client_note end,
    error_code = case when p_fields ? 'error_code' then p_fields->>'error_code' else error_code end,
    repair_attempts = case when p_fields ? 'repair_attempts' then (p_fields->>'repair_attempts')::int else repair_attempts end,
    stage_state = case when p_fields ? 'stage_state' then stage_state || (p_fields->'stage_state') else stage_state end
  where id = p_task_id;
end;
$$;

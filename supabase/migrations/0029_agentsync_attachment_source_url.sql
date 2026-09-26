-- Attachments come from the source system with the request: either inline
-- (base64, stored at submission) or as an https URL the worker downloads
-- before analysis — so a slow download never holds up the submission call.

alter table agentsync.task_attachments add column if not exists source_url text;

drop function if exists public.agentsync_add_task_attachment(uuid, text, text, bigint);

create or replace function public.agentsync_add_task_attachment(
  p_task_id uuid, p_filename text, p_media_type text, p_size bigint, p_source_url text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_task agentsync.agent_tasks;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  select * into v_task from agentsync.agent_tasks where id = p_task_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'NO_SUCH_TASK'); end if;
  if not agentsync.attachment_type_allowed(p_media_type) then
    return jsonb_build_object('ok', false, 'error', 'TYPE_NOT_ALLOWED', 'detail', p_media_type);
  end if;
  if (select count(*) from agentsync.task_attachments where task_id = p_task_id) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY');
  end if;
  if p_source_url is not null and p_source_url !~ '^https://' then
    return jsonb_build_object('ok', false, 'error', 'URL_MUST_BE_HTTPS');
  end if;
  v_path := v_task.tenant_id::text || '/' || v_id::text || '/'
            || left(coalesce(nullif(regexp_replace(trim(p_filename), '[^A-Za-z0-9._-]+', '_', 'g'), ''), 'file'), 120);
  insert into agentsync.task_attachments
    (id, tenant_id, project_id, task_id, filename, media_type, size_bytes, storage_path, source_url)
  values (v_id, v_task.tenant_id, v_task.project_id, p_task_id, left(trim(p_filename), 255),
          p_media_type, greatest(coalesce(p_size, 1), 1), v_path, p_source_url);
  return jsonb_build_object('ok', true, 'attachment_id', v_id, 'storage_path', v_path);
end;
$$;

-- The worker records the real size once a URL has been downloaded.
create or replace function public.agentsync_update_attachment(p_id uuid, p_fields jsonb)
returns void
language sql security definer set search_path = ''
as $$
  update agentsync.task_attachments set
    size_bytes = case when p_fields ? 'size_bytes' then (p_fields->>'size_bytes')::bigint else size_bytes end,
    source_url = case when p_fields ? 'source_url' then p_fields->>'source_url' else source_url end,
    sha256 = case when p_fields ? 'sha256' then p_fields->>'sha256' else sha256 end,
    extracted_text = case when p_fields ? 'extracted_text' then p_fields->>'extracted_text' else extracted_text end,
    status = case when p_fields ? 'status' then p_fields->>'status' else status end,
    problem = case when p_fields ? 'problem' then p_fields->>'problem' else problem end,
    anthropic_file_id = case when p_fields ? 'anthropic_file_id' then p_fields->>'anthropic_file_id' else anthropic_file_id end,
    openai_file_id = case when p_fields ? 'openai_file_id' then p_fields->>'openai_file_id' else openai_file_id end
  where id = p_id;
$$;

revoke all on function public.agentsync_add_task_attachment(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.agentsync_add_task_attachment(uuid, text, text, bigint, text) to service_role;

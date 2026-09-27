import { NextResponse, type NextRequest } from 'next/server';
import { cleanupProviderFiles } from '@/lib/attachments';
import { currentUser } from '@/lib/auth';
import { engineerSessionState, stopEngineerSession } from '@/lib/managed-engineer';
import { openaiEngineerState, stopOpenAIEngineer } from '@/lib/openai-engineer';
import { aiContext, loadJob, sendCallback } from '@/lib/stages';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/tasks/:id/stop — stop a task while an agent is building it.
 *
 * The database function checks the person may approve work for the task's
 * tenant and that it is building or checking, then fails it with
 * STOPPED_BY_USER (so Retry is available). Then the Engineer's sandbox session
 * is stopped, so it stops billing, and what it cost so far is recorded.
 */

const STATUS: Record<string, number> = { NOT_AUTHORISED: 403, NO_SUCH_TASK: 404, NOT_RUNNING: 409 };

export const maxDuration = 60;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { id } = await params;
  const { data, error } = await serviceClient().rpc('agentsync_stop_task', { p_user_id: user.id, p_task_id: id });
  if (error) {
    console.error('stop failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const result = data as { ok: boolean; error?: string; detail?: string };
  if (!result.ok) {
    return NextResponse.json({ error: result.error, detail: result.detail }, { status: STATUS[result.error ?? ''] ?? 422 });
  }

  try {
    const job = await loadJob(id);
    const ctx = aiContext(job);
    const state = job.task.stage_state as {
      session_id?: string | null;
      session_model?: string | null;
      session_provider?: 'anthropic' | 'openai' | null;
      session_started_at?: string | null;
    };
    if (state.session_id) {
      const onOpenAI = state.session_provider === 'openai';
      await (onOpenAI ? stopOpenAIEngineer(ctx, state.session_id) : stopEngineerSession(ctx, state.session_id));
      const finalState = await (onOpenAI
        ? openaiEngineerState(ctx, state.session_id, state.session_model ?? 'gpt-5.5')
        : engineerSessionState(ctx, state.session_id)).catch(() => null);
      if (finalState) {
        await serviceClient().rpc('agentsync_record_ai_usage', {
          p_task_id: id,
          p_agent_key: 'engineer',
          p_model: state.session_model ?? 'claude-opus-5-5',
          p_input_tokens: finalState.usage.input,
          p_output_tokens: finalState.usage.output,
          p_cost: finalState.usage.costCents / 100,
          p_duration_seconds: (Date.now() - Date.parse(state.session_started_at ?? new Date().toISOString())) / 1000,
          p_provider: onOpenAI ? 'openai' : 'anthropic',
          p_failover: false,
        });
      }
      await serviceClient().rpc('agentsync_update_task', {
        p_task_id: id,
        p_fields: { stage_state: { session_id: null } },
      });
    }
    await cleanupProviderFiles(ctx, id).catch(() => undefined);
    await sendCallback(job, 'failed', `Stopped in AgentSync by ${user.email}`).catch(() => undefined);
  } catch (e) {
    console.error('could not stop the sandbox session', e);
  }
  return NextResponse.json({ ok: true, status: 'failed' });
}

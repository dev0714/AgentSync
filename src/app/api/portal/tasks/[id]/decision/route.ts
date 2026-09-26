import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { closePullRequest, githubFor } from '@/lib/github';
import { kickWorker } from '@/lib/kick';
import { cleanupProviderFiles } from '@/lib/attachments';
import { aiContext, loadJob } from '@/lib/stages';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/portal/tasks/:id/decision — a person opens or closes a gate.
 *
 *   { "gate": "plan" | "merge", "decision": "approved" | "changes_requested" | "rejected", "comment"?: string }
 *
 * The user comes from the session cookie. The database function checks that
 * they may approve for the task's tenant and that the task is actually waiting
 * at this gate, records the decision against them, and makes the move — the
 * only path by which a gate opens.
 */

export const maxDuration = 300;

const STATUS: Record<string, number> = {
  NOT_AUTHORISED: 403,
  NO_SUCH_TASK: 404,
  NOT_AT_GATE: 409,
  COMMENT_REQUIRED: 422,
  UNKNOWN_GATE: 422,
  UNKNOWN_DECISION: 422,
  UNSUPPORTED_DECISION: 422,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }

  const { id } = await params;
  const { data, error } = await serviceClient().rpc('agentsync_decide_approval', {
    p_user_id: user.id,
    p_task_id: id,
    p_gate: String(body.gate ?? ''),
    p_decision: String(body.decision ?? ''),
    p_comment: typeof body.comment === 'string' ? body.comment : null,
  });
  if (error) {
    console.error('decision failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }

  const result = data as { ok: boolean; error?: string; detail?: string; status?: string };
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: STATUS[result.error ?? ''] ?? 422 },
    );
  }

  // A rejected merge closes the pull request so it doesn't linger open.
  if (result.status === 'cancelled') {
    try {
      const job = await loadJob(id);
      await cleanupProviderFiles(aiContext(job), id).catch(() => undefined);
      if (job.task.pull_request_number && job.repository) {
        const repo = {
          owner: job.repository.github_owner,
          repo: job.repository.repository,
          defaultBranch: job.repository.default_branch || 'main',
        };
        await closePullRequest(await githubFor(job.github, repo), repo, job.task.pull_request_number,
          `Rejected in AgentSync by ${user.email}.`);
      }
    } catch (e) {
      console.error('could not close pull request after rejection', e);
    }
  } else {
    kickWorker('decision');
  }

  return NextResponse.json({ ok: true, status: result.status });
}

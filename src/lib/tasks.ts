import 'server-only';
import type { Candidate } from './routing';
import { serviceClient } from './supabase';

/**
 * The task lifecycle, as the application sees it.
 *
 * Everything that could race lives in the database, not here: legal
 * transitions, the idempotency check, and the queue claim are all enforced in
 * SQL so they hold when several workers run at once. This module is a typed
 * wrapper over those functions plus the request validation the HTTP layer
 * needs.
 */

export const REQUEST_TYPES = [
  'code_change',
  'refactor',
  'dependency_update',
  'migration',
  'investigation',
  'estimate',
  'custom',
] as const;

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];

export type SubmitRequest = {
  /** The project to work in — or leave it out and send `client` instead. */
  project_id?: string;
  /**
   * The source system's own client. AgentSync routes the task to the project
   * this client is mapped to on the Source systems screen; an unmapped client
   * is recorded for mapping and the task is refused with CLIENT_NOT_MAPPED.
   */
  client?: { id: string; name?: string };
  idempotency_key: string;
  title: string;
  description?: string;
  external_reference?: string;
  request_type?: RequestType;
  priority?: Priority;
  acceptance_criteria?: string[];
  requested_by?: { id?: string; name?: string };
  callback_url?: string;
};

/** Every rejection reason the submission endpoint can produce. */
export type SubmitError =
  | 'INVALID_API_KEY'
  | 'SOURCE_DISABLED'
  | 'IP_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'PROJECT_DISABLED'
  | 'PROJECT_NOT_FOUND'
  | 'CLIENT_NOT_MAPPED'
  | 'ROUTING_REQUIRED'
  | 'PROJECT_NOT_MAPPED_TO_CLIENT'
  | 'VALIDATION_FAILED'
  | 'INTERNAL_ERROR';

export type SubmitResult =
  | {
      ok: true;
      task_id: string;
      correlation_id: string;
      status: string;
      /** false when an existing task was returned for a repeated idempotency key */
      created: boolean;
      project_id?: string;
      project_name?: string;
    }
  | { ok: false; error: SubmitError; detail?: string; candidates?: Candidate[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shape and range checks that don't need the database. Returns a list of
 * problems so a caller fixing a payload sees all of them at once rather than
 * one per round trip.
 */
export function validateSubmission(body: unknown): string[] {
  const problems: string[] = [];
  if (typeof body !== 'object' || body === null) return ['body must be an object'];
  const b = body as Record<string, unknown>;

  const client = b.client as { id?: unknown; name?: unknown } | undefined;
  if (b.project_id !== undefined) {
    if (typeof b.project_id !== 'string' || !UUID.test(b.project_id)) {
      problems.push('project_id must be a uuid');
    }
  } else if (client === undefined) {
    problems.push('project_id or client is required');
  }
  if (client !== undefined) {
    if (typeof client !== 'object' || client === null || typeof client.id !== 'string' || !client.id.trim()) {
      problems.push('client.id is required when client is given');
    } else if (client.id.length > 200) {
      problems.push('client.id must be 200 characters or fewer');
    }
    if (client && client.name !== undefined && (typeof client.name !== 'string' || client.name.length > 300)) {
      problems.push('client.name must be a string of 300 characters or fewer');
    }
  }
  if (typeof b.idempotency_key !== 'string' || b.idempotency_key.length < 1) {
    problems.push('idempotency_key is required');
  } else if (b.idempotency_key.length > 200) {
    problems.push('idempotency_key must be 200 characters or fewer');
  }
  if (typeof b.title !== 'string' || b.title.trim().length === 0) {
    problems.push('title is required');
  } else if (b.title.length > 500) {
    problems.push('title must be 500 characters or fewer');
  }
  if (b.request_type !== undefined && !REQUEST_TYPES.includes(b.request_type as RequestType)) {
    problems.push(`request_type must be one of ${REQUEST_TYPES.join(', ')}`);
  }
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority as Priority)) {
    problems.push(`priority must be one of ${PRIORITIES.join(', ')}`);
  }
  if (b.acceptance_criteria !== undefined) {
    if (
      !Array.isArray(b.acceptance_criteria) ||
      b.acceptance_criteria.some((c) => typeof c !== 'string')
    ) {
      problems.push('acceptance_criteria must be an array of strings');
    } else if (b.acceptance_criteria.length > 50) {
      problems.push('acceptance_criteria must have 50 entries or fewer');
    }
  }
  if (b.callback_url !== undefined) {
    if (typeof b.callback_url !== 'string') {
      problems.push('callback_url must be a string');
    } else {
      // A callback is an outbound request AgentSync will make on the caller's
      // behalf, so it must be https and must not be a bare hostname.
      let url: URL | null = null;
      try {
        url = new URL(b.callback_url);
      } catch {
        problems.push('callback_url must be an absolute URL');
      }
      if (url && url.protocol !== 'https:') {
        problems.push('callback_url must use https');
      }
    }
  }
  return problems;
}

/**
 * Submits a task. Authentication, the IP allowlist, the rate limit and the
 * idempotency check all happen inside the database function, so this cannot
 * accidentally skip one of them.
 */
export async function submitTask(
  apiKey: string | null,
  ip: string | null,
  body: SubmitRequest,
): Promise<SubmitResult> {
  const { data, error } = await serviceClient().rpc('agentsync_submit_task', {
    payload: {
      api_key: apiKey,
      ip,
      project_id: body.project_id ?? null,
      client: body.client ? { id: body.client.id, name: body.client.name ?? null } : null,
      idempotency_key: body.idempotency_key,
      title: body.title,
      description: body.description ?? null,
      external_reference: body.external_reference ?? null,
      request_type: body.request_type ?? 'code_change',
      priority: body.priority ?? 'normal',
      acceptance_criteria: body.acceptance_criteria ?? [],
      requested_by: body.requested_by ?? null,
      callback_url: body.callback_url ?? null,
    },
  });

  if (error) {
    // PROJECT_DISABLED and the tenant-mismatch guard are raised inside SQL.
    const message = error.message ?? '';
    if (message.includes('PROJECT_DISABLED')) return { ok: false, error: 'PROJECT_DISABLED' };
    if (message.includes('does not belong to tenant')) {
      return { ok: false, error: 'PROJECT_NOT_FOUND' };
    }
    console.error('submitTask failed', error);
    return { ok: false, error: 'INTERNAL_ERROR' };
  }

  const result = data as Record<string, unknown>;
  if (result?.ok === false) {
    if (result.error === 'ROUTING_REQUIRED') {
      return { ok: false, error: 'ROUTING_REQUIRED', candidates: (result.candidates as Candidate[]) ?? [] };
    }
    if (result.error === 'PROJECT_NOT_MAPPED_TO_CLIENT') {
      return { ok: false, error: 'PROJECT_NOT_MAPPED_TO_CLIENT', detail: 'That repository is not one this client is mapped to.' };
    }
    if (result.error === 'CLIENT_NOT_MAPPED') {
      return {
        ok: false,
        error: 'CLIENT_NOT_MAPPED',
        detail: 'This client is not mapped to a repository yet. Map it on the Source systems screen, then send again.',
      };
    }
    return { ok: false, error: result.error as SubmitError };
  }
  return {
    ok: true,
    task_id: result.task_id as string,
    correlation_id: result.correlation_id as string,
    status: result.status as string,
    created: result.created as boolean,
    project_id: result.project_id as string | undefined,
    project_name: result.project_name as string | undefined,
  };
}

/* ---- queue ----------------------------------------------------------- */

export type ClaimedTask = {
  task_id: string;
  tenant_id: string;
  project_id: string;
  correlation_id: string;
  title: string;
  request_type: RequestType;
  priority: Priority;
  /** The status the task was in when claimed; a new task arrives as `analysing`. */
  status: string;
  lock_expires_at: string;
};

/** Claims one queued task, or null when the queue is empty for this worker. */
export async function claimNextTask(
  workerId: string,
  leaseSeconds = 1800,
): Promise<ClaimedTask | null> {
  const { data, error } = await serviceClient().rpc('agentsync_claim_next_task', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return (data as ClaimedTask | null) ?? null;
}

/**
 * Moves a task to a new status. Pass `workerId` whenever a worker is making
 * the move — the database refuses it if the task is held by anyone else.
 */
export async function transitionTask(params: {
  taskId: string;
  to: string;
  actor?: string;
  message?: string;
  workerId?: string;
}): Promise<string> {
  const { data, error } = await serviceClient().rpc('agentsync_transition_task', {
    p_task_id: params.taskId,
    p_to: params.to,
    p_actor: params.actor ?? 'system',
    p_message: params.message ?? null,
    p_worker_id: params.workerId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function heartbeat(
  taskId: string,
  workerId: string,
  leaseSeconds = 1800,
): Promise<boolean> {
  const { data, error } = await serviceClient().rpc('agentsync_heartbeat_task', {
    p_task_id: taskId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return Boolean(data);
}

/** Returns tasks whose worker died to the queue. Run this on a schedule. */
export async function reclaimExpiredTasks(): Promise<number> {
  const { data, error } = await serviceClient().rpc('agentsync_reclaim_expired_tasks');
  if (error) throw error;
  return (data as number) ?? 0;
}

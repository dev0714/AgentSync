import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase';

/**
 * PUT /api/v1/agent/clients — a source system reports its clients.
 *
 *   Authorization: Bearer ask_live_…
 *   { "clients": [{ "id": "…", "name": "Acme", "active": true }] }
 *
 * The clients appear on the Source systems screen, where each is mapped to a
 * repository. Tasks sent with `client` instead of `project_id` go to the
 * mapped project. Sending the list again updates names and is safe to repeat.
 */

const STATUS: Record<string, number> = {
  INVALID_API_KEY: 401,
  SOURCE_DISABLED: 403,
  IP_NOT_ALLOWED: 403,
  VALIDATION_FAILED: 422,
};

export async function PUT(request: NextRequest) {
  const header = request.headers.get('authorization') ?? '';
  const apiKey = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!apiKey) {
    return NextResponse.json({ error: 'INVALID_API_KEY', message: 'Provide a source-system key as a bearer token.' }, { status: 401 });
  }

  let body: { clients?: unknown };
  try {
    body = (await request.json()) as { clients?: unknown };
  } catch {
    return NextResponse.json({ error: 'VALIDATION_FAILED', message: 'Body must be JSON.' }, { status: 422 });
  }
  if (!Array.isArray(body.clients)) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', message: 'clients must be an array.' }, { status: 422 });
  }
  const clients = body.clients
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      id: String(c.id ?? '').slice(0, 200),
      name: String(c.name ?? '').slice(0, 300),
      active: c.active === undefined ? true : Boolean(c.active),
    }))
    .filter((c) => c.id.trim());

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip');
  const { data, error } = await serviceClient().rpc('agentsync_source_sync_clients', {
    payload: { api_key: apiKey, ip, clients },
  });
  if (error) {
    console.error('client sync failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const result = data as { ok: boolean; error?: string; synced?: number; mapped?: number };
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error ?? ''] ?? 400 });
  }
  return NextResponse.json({ synced: result.synced, mapped: result.mapped });
}

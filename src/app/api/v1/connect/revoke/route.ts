import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabase';

/**
 * POST /api/v1/connect/revoke — a source disconnects itself.
 * Authorization: Bearer ask_live_… ; the source is disabled, so its key stops
 * working. Its client mappings stay, ready for a reconnect.
 */
export async function POST(request: NextRequest) {
  const header = request.headers.get('authorization') ?? '';
  const apiKey = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!apiKey) return NextResponse.json({ error: 'INVALID_API_KEY' }, { status: 401 });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip');
  const { data, error } = await serviceClient().rpc('agentsync_source_revoke', { payload: { api_key: apiKey, ip } });
  if (error) {
    console.error('source revoke failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
  return NextResponse.json({ ok: true });
}

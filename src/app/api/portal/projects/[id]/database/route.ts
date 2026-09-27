import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';

/**
 * GET|POST /api/portal/projects/:id/database — which Supabase project a
 * project's database changes run on, and where its migration files live.
 *
 *   POST { supabase_project_ref: string | null, migration_paths?: string[] }
 */

const STATUS: Record<string, number> = { NOT_AUTHORISED: 403, BAD_PROJECT_REF: 422 };

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const { data, error } = await serviceClient().rpc('agentsync_project_database', { p_user_id: user.id, p_project_id: id });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const r = data as { ok: boolean; error?: string };
  return NextResponse.json(r, { status: r.ok ? 200 : STATUS[r.error ?? ''] ?? 422 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as { supabase_project_ref?: string | null; migration_paths?: unknown };
  const paths = Array.isArray(b.migration_paths)
    ? b.migration_paths.map((p) => String(p).trim()).filter(Boolean).slice(0, 20)
    : null;
  const { data, error } = await serviceClient().rpc('agentsync_project_database_set', {
    p_user_id: user.id,
    p_project_id: id,
    p_supabase_project_ref: b.supabase_project_ref ? String(b.supabase_project_ref) : null,
    p_migration_paths: paths,
  });
  if (error) return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  const r = data as { ok: boolean; error?: string };
  return NextResponse.json(r, { status: r.ok ? 200 : STATUS[r.error ?? ''] ?? 422 });
}

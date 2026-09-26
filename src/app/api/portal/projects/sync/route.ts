import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { syncGithubProjects } from '@/lib/github-connect';

/**
 * POST /api/portal/projects/sync  { tenant_slug }
 *
 * Each repository the GitHub App is installed on is a project. This re-reads
 * the installation from GitHub and creates, re-enables or disables projects
 * to match — the manual counterpart to the automatic sync on connect.
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }

  try {
    const result = await syncGithubProjects(user.id, String(b.tenant_slug ?? ''));
    if (!result.ok) return NextResponse.json(result, { status: 422 });
    return NextResponse.json(result);
  } catch (e) {
    console.error('project sync failed', e);
    return NextResponse.json({ error: 'GITHUB_UNREACHABLE' }, { status: 502 });
  }
}

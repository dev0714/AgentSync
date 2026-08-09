import { NextResponse } from 'next/server';

/**
 * Sign out: clear the session cookie.
 *
 * The cookie name is duplicated from src/lib/auth.ts rather than imported —
 * that module is marked server-only and pulls in the Supabase service client,
 * which this route has no need for.
 */
const SESSION_COOKIE = 'agentsync_session';

export async function POST() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set(SESSION_COOKIE, '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}

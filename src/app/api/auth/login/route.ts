import { NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/auth';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
} from '@/lib/session';

/**
 * Sign in. On success sets the signed session cookie; on failure returns the
 * same message whatever went wrong, so the response cannot be used to work out
 * which email addresses have accounts.
 */
export async function POST(request: Request) {
  let email: unknown;
  let password: unknown;

  try {
    const body = await request.json();
    email = body?.email;
    password = body?.password;
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required.' },
      { status: 400 },
    );
  }

  let userId: string | null;
  try {
    userId = await verifyPassword(email, password);
  } catch (error) {
    console.error('login failed', error);
    return NextResponse.json(
      { error: 'Sign-in is unavailable. Try again shortly.' },
      { status: 500 },
    );
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'That email and password do not match an active account.' },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await signSession(userId), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';

/**
 * Gate the portal. The signature is checked here, at the edge, so an
 * unauthenticated request never reaches a page that would query the database.
 * The user record itself is loaded per request inside the page — this only
 * decides whether there is a valid session at all.
 */
export async function middleware(request: NextRequest) {
  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
  );

  if (session) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  // Come back to whatever was being asked for once signed in.
  url.searchParams.set('next', request.nextUrl.pathname);

  const response = NextResponse.redirect(url);
  // Clear an expired or tampered cookie so it stops being sent.
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  matcher: ['/portal/:path*'],
};

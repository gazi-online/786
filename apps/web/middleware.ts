import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Middleware: Authentication & Protected Route Guard
 * Redirects unauthenticated users away from protected dashboard pages to /signin.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protected application routes
  const isProtectedRoute =
    pathname.startsWith('/transactions') ||
    pathname.startsWith('/devices') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/reports') ||
    pathname.startsWith('/onboarding');

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Inspect cookies for Supabase session token (standard or chunked .0 format)
  const cookies = req.cookies.getAll();
  const hasAuthToken = cookies.some((c) => {
    const name = c.name;
    return (
      name === 'sb-auth-token' ||
      name.startsWith('sb-') && (name.includes('-auth-token') || name.includes('auth-token'))
    );
  });

  if (!hasAuthToken) {
    const redirectUrl = new URL('/signin', req.url);
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/transactions/:path*',
    '/devices/:path*',
    '/settings/:path*',
    '/reports/:path*',
    '/onboarding/:path*',
  ],
};


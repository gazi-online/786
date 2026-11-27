import { describe, it, expect } from 'vitest';
import config from '../next.config';

describe('Round 6 Step 4: Next.js Security Headers & CSP Assertions', () => {
  it('preserves immutable Cache-Control for static Next.js assets', async () => {
    process.env.DATABASE_URL = 'postgres://dummy:dummy@localhost:5432/dummy_test';
    process.env.SUPABASE_JWT_SECRET = 'dummy-prod-secret-32-chars-long';
    const nextConfig = config('phase-production-server');
    const headersList = await nextConfig.headers!();

    const staticHeader = headersList.find((h) => h.source === '/_next/static/(.*)');
    expect(staticHeader).toBeDefined();

    const cacheControl = staticHeader!.headers.find((h) => h.key === 'Cache-Control');
    expect(cacheControl).toBeDefined();
    expect(cacheControl!.value).toBe('public, max-age=31536000, immutable');
  });

  it('enforces strict production CSP: NO unsafe-eval, NO localhost in connect-src', async () => {
    process.env.DATABASE_URL = 'postgres://dummy:dummy@localhost:5432/dummy_test';
    process.env.SUPABASE_JWT_SECRET = 'dummy-prod-secret-32-chars-long';
    const nextConfig = config('phase-production-server');
    const headersList = await nextConfig.headers!();

    const rootHeader = headersList.find((h) => h.source === '/(.*)');
    expect(rootHeader).toBeDefined();

    const csp = rootHeader!.headers.find((h) => h.key === 'Content-Security-Policy');
    expect(csp).toBeDefined();

    // 1. Must NOT contain 'unsafe-eval'
    expect(csp!.value).not.toContain("'unsafe-eval'");

    // 2. Must NOT allow localhost in connect-src
    expect(csp!.value).not.toContain('localhost');
    expect(csp!.value).not.toContain('http://localhost:*');
    expect(csp!.value).not.toContain('ws://localhost:*');

    // 3. Must preserve Supabase and self in connect-src
    expect(csp!.value).toContain("connect-src 'self' https://*.supabase.co");

    // 4. Standard security headers
    const xContentType = rootHeader!.headers.find((h) => h.key === 'X-Content-Type-Options');
    expect(xContentType?.value).toBe('nosniff');

    const xFrame = rootHeader!.headers.find((h) => h.key === 'X-Frame-Options');
    expect(xFrame?.value).toBe('DENY');

    const referrer = rootHeader!.headers.find((h) => h.key === 'Referrer-Policy');
    expect(referrer?.value).toBe('strict-origin-when-cross-origin');

    const perms = rootHeader!.headers.find((h) => h.key === 'Permissions-Policy');
    expect(perms?.value).toContain('camera=()');
    expect(perms?.value).toContain('microphone=()');
    expect(perms?.value).toContain('geolocation=()');
  });

  it('allows localhost and development eval only during development server phase', async () => {
    const origEnv = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      const devConfig = config('phase-development-server');
      const headersList = await devConfig.headers!();
      const rootHeader = headersList.find((h) => h.source === '/(.*)');
      const csp = rootHeader!.headers.find((h) => h.key === 'Content-Security-Policy');

      expect(csp!.value).toContain("'unsafe-eval'");
      expect(csp!.value).toContain('localhost');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
    }
  });
});

import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';

export default function config(phase: string): NextConfig {
  // Amd-2: Allow dummy values strictly during production build phase, never at next start or dev
  if (phase === PHASE_PRODUCTION_BUILD) {
    if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
      process.env.DATABASE_URL = 'postgres://dummy:dummy@localhost:5432/dummy_build';
    }
    if (!process.env.SUPABASE_JWT_SECRET) {
      process.env.SUPABASE_JWT_SECRET = 'dummy-build-jwt-secret-do-not-use-in-runtime';
    }
  }

  // Production Boot Guard: Refuse to boot in production at server startup without a database or jwt secret
  if (phase === PHASE_PRODUCTION_SERVER) {
    if (process.env.ALLOW_IN_MEMORY_STORE === 'true' || process.env.ALLOW_IN_MEMORY_STORE === '1') {
      throw new Error(
        'FATAL: ALLOW_IN_MEMORY_STORE is strictly forbidden in production (NODE_ENV=production). Refusing to start.',
      );
    }
    if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
      throw new Error(
        'FATAL: Production requires DATABASE_URL or SUPABASE_DB_URL. In-memory store cannot be used in production. Refusing to start.',
      );
    }
    if (!process.env.SUPABASE_JWT_SECRET) {
      throw new Error(
        'FATAL: Production requires SUPABASE_JWT_SECRET. Refusing to start.',
      );
    }
  }

  const isProd =
    phase === PHASE_PRODUCTION_SERVER ||
    phase === PHASE_PRODUCTION_BUILD ||
    process.env.NODE_ENV === 'production';

  // CSP Hardening (Round 6):
  // - In production: NO 'unsafe-eval'
  // - In production: NO localhost in connect-src (strictly 'self' and https://*.supabase.co)
  // - Scripts: Next.js App Router client bootstrap chunks and inline hydration scripts
  //   require 'unsafe-inline' when static pre-rendering without per-request middleware nonces.
  const scriptSrc = isProd
    ? "'self' 'unsafe-inline'"
    : "'self' 'unsafe-eval' 'unsafe-inline'";

  const connectSrc = isProd
    ? "'self' https://*.supabase.co"
    : "'self' http://localhost:* ws://localhost:* https://*.supabase.co";

  const cspHeader = `
    default-src 'self';
    script-src ${scriptSrc};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:;
    font-src 'self' data:;
    connect-src ${connectSrc};
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
  `.replace(/\s{2,}/g, ' ').trim();

  return {
    reactStrictMode: true,
    compress: true,
    poweredByHeader: false,
    transpilePackages: ['@walletsync/contract'],
    experimental: {
      optimizePackageImports: ['lucide-react', 'recharts'],
    },
    async headers() {
      return [
        {
          source: '/_next/static/(.*)',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
        },
        {
          source: '/(.*)',
          headers: [
            {
              key: 'Content-Security-Policy',
              value: cspHeader,
            },
            {
              key: 'X-Content-Type-Options',
              value: 'nosniff',
            },
            {
              key: 'X-Frame-Options',
              value: 'DENY',
            },
            {
              key: 'Referrer-Policy',
              value: 'strict-origin-when-cross-origin',
            },
            {
              key: 'Permissions-Policy',
              value: 'camera=(), microphone=(), geolocation=()',
            },
          ],
        },
      ];
    },
  };
}

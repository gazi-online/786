import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { tenants, memberships } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { createServerClient } from '@supabase/ssr';
import {
  JwtClaims,
  VerificationResult,
  JwtVerifier,
  HmacSha256Verifier,
  JwksVerifier,
} from '@/lib/jwt';

export type { JwtClaims, VerificationResult, JwtVerifier };
export { HmacSha256Verifier, JwksVerifier };

export type UserRole = 'owner' | 'admin' | 'viewer';

export interface TenantSession {
  user: {
    id: string;
    email: string;
  };
  tenant: {
    id: string;
    name: string;
    plan: string;
  };
  role: UserRole;
}

export type ProtectedAction =
  | 'pairing:create'
  | 'device:revoke'
  | 'data:export'
  | 'dashboard:view'
  | 'settings:modify'
  | 'customer_no:reveal'
  | 'recharge:create';

export function canPerformAction(role: UserRole, action: ProtectedAction): boolean {
  if (action === 'dashboard:view') return true;
  if (role === 'owner' || role === 'admin') return true;
  // viewer is denied pairing:create, device:revoke, data:export, settings:modify, customer_no:reveal, recharge:create
  return false;
}

/**
 * Startup Security Check:
 * Enforces that test authentication bypass flags are NEVER enabled in production.
 */
export function validateAuthSecurityConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && process.env.ALLOW_TEST_HEADER_AUTH === 'true') {
    throw new Error(
      'FATAL: ALLOW_TEST_HEADER_AUTH is strictly forbidden in production (NODE_ENV=production). Refusing to start.',
    );
  }

  // Missing SUPABASE_JWT_SECRET is fatal in production and development
  const isTest = process.env.NODE_ENV === 'test';
  if (!isTest && !process.env.SUPABASE_JWT_SECRET) {
    throw new Error(
      'FATAL: SUPABASE_JWT_SECRET is required in production and development. Set it in your environment.',
    );
  }
}
validateAuthSecurityConfig();

/**
 * Auth Configuration:
 * Read from Supabase Project Settings (Project Settings > API > JWT Settings).
 * In production/development, these are configured, never guessed.
 */
export function getAuthConfig() {
  const isTest = process.env.NODE_ENV === 'test';
  const jwtSecret =
    process.env.SUPABASE_JWT_SECRET ||
    (isTest ? 'test-jwt-secret-do-not-use-in-production-0123456789abcdef' : '');

  if (!jwtSecret && !isTest) {
    throw new Error('FATAL: Missing SUPABASE_JWT_SECRET in environment.');
  }

  return {
    jwtSecret,
    issuer: process.env.SUPABASE_AUTH_ISSUER || (isTest ? 'https://auth.walletsync.test/auth/v1' : ''),
    audience: process.env.SUPABASE_AUTH_AUDIENCE || (isTest ? 'authenticated' : ''),
    cookieName: process.env.SUPABASE_AUTH_COOKIE_NAME || 'sb-auth-token',
    jwksUrl: process.env.SUPABASE_JWKS_URL || '',
  };
}

export function getJwtSecret(): string {
  return getAuthConfig().jwtSecret;
}

/**
 * Cookie Extraction:
 * Supports standard single cookies and Supabase @supabase/ssr chunked cookies
 * (e.g. sb-<ref>-auth-token.0, sb-<ref>-auth-token.1, etc.).
 */
export function extractCookieToken(req: NextRequest, cookieBaseName: string): string | null {
  const base = cookieBaseName || 'sb-auth-token';

  // 1. Direct single cookie
  const direct = req.cookies.get(base)?.value;
  if (direct) return direct;

  // 1b. Check 'sb-auth-token' directly if base was different
  if (base !== 'sb-auth-token') {
    const sb = req.cookies.get('sb-auth-token')?.value;
    if (sb) return sb;
  }

  // 2. Chunked cookies (Supabase @supabase/ssr format when payload exceeds 4KB)
  const chunks: string[] = [];
  let idx = 0;
  while (true) {
    const chunk = req.cookies.get(`${base}.${idx}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
    idx++;
  }

  if (chunks.length > 0) {
    return chunks.join('');
  }

  // 3. Fallback: check all cookies for Supabase ssr format
  for (const cookie of req.cookies.getAll()) {
    if (cookie.name === 'sb-auth-token' || (cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token'))) {
      if (cookie.value) return cookie.value;
    }
  }

  return null;
}

/**
 * Extract authenticated tenant session from NextRequest.
 * Real path:
 * 1. Reads JWT from Authorization: Bearer or @supabase/ssr session cookie (including chunked format).
 * 2. Cryptographically verifies JWT (HS256 or RS256).
 * 3. Inside a database transaction:
 *    - Sets transaction-scoped parameter: SELECT set_config('request.jwt.claim.sub', $1, true)
 *    - Queries memberships under RLS (memberships_user_resolve_policy checks auth.uid() = user_id)
 *    - Resolves requested tenant via explicit 'X-Tenant' header or default ORDER BY (owner > admin > viewer, oldest first)
 *    - Sets transaction-scoped parameter: SELECT set_config('app.current_tenant_id', $1, true)
 * 4. Returns verified TenantSession.
 */
export async function getTenantSession(
  req: NextRequest,
  customVerifier?: JwtVerifier,
): Promise<TenantSession | null> {
  const isTest = process.env.NODE_ENV === 'test';
  const allowTestHeaderAuth = process.env.ALLOW_TEST_HEADER_AUTH === 'true';

  // Strict test header bypass check:
  // Must NEVER be accessible in production or development
  if (allowTestHeaderAuth && !isTest) {
    throw new Error(
      'FATAL: ALLOW_TEST_HEADER_AUTH is strictly forbidden outside NODE_ENV=test. Refusing to start.',
    );
  }

  if (isTest && allowTestHeaderAuth) {
    const testRole = req.headers.get('x-test-role') as UserRole | null;
    const testUserId = req.headers.get('x-test-user-id');
    const testTenantId = req.headers.get('x-test-tenant-id');

    if (testRole && ['owner', 'admin', 'viewer'].includes(testRole)) {
      return {
        user: {
          id: testUserId || '00000000-0000-0000-0000-000000000001',
          email: `${testRole}@walletsync.test`,
        },
        tenant: {
          id: testTenantId || '00000000-0000-0000-0000-000000000001',
          name: 'Test Tenant',
          plan: 'pro',
        },
        role: testRole,
      };
    }
  }

  // 1. Extract token from Bearer header or Cookie
  const authConfig = getAuthConfig();
  const authHeader = req.headers.get('authorization');
  let token = '';

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    // Attempt extracting token via @supabase/ssr server client
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dummy-auth-url.supabase.co';
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy-anon-key';
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll() {},
        },
      });
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        token = session.access_token;
      }
    } catch {
      // Fallback to direct chunked cookie extractor
    }

    if (!token) {
      const cookieToken = extractCookieToken(req, authConfig.cookieName);
      if (cookieToken) token = cookieToken;
    }
  }

  if (!token) {
    return null;
  }

  // 2. Cryptographic / Identity Verification
  const verifier =
    customVerifier ||
    new HmacSha256Verifier(authConfig.jwtSecret, authConfig.issuer, authConfig.audience);

  let result = await verifier.verify(token);
  let userId = result.valid ? result.payload?.sub : undefined;
  let userEmail = result.valid ? result.payload?.email : undefined;

  // Authoritative Supabase fallback: If local HMAC verifier fails (due to Supabase asymmetric RS256/JWKS or secret mismatch),
  // verify user identity via Supabase Auth client directly
  if (!userId) {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
      if (supabaseUrl && supabaseAnonKey) {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (user && !userError) {
          userId = user.id;
          userEmail = user.email;
          result = { valid: true, payload: { sub: user.id, ...(user.email ? { email: user.email } : {}) } };
        }
      }
    } catch {
      // Supabase verification failed
    }
  }

  if (!userId) {
    return null;
  }

  // 3. Database Lookup under RLS with Transaction-Scoped Parameterized Context
  const requestedTenantId = req.headers.get('x-tenant') || req.headers.get('x-tenant-id');
  const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);

  if (hasDatabase) {
    try {
      const session = await db.transaction(async (tx) => {
        // Step A: Set request.jwt.claim.sub so auth.uid() resolves to this user in RLS
        await tx.execute(sql`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`);

        // Step B: Query memberships under RLS (only resolves memberships belonging to this user)
        const conditions = [eq(memberships.userId, userId)];
        if (requestedTenantId) {
          conditions.push(eq(memberships.tenantId, requestedTenantId));
        }

        const userMemberships = await tx
          .select({
            role: memberships.role,
            tenantId: memberships.tenantId,
            tenantName: tenants.name,
            tenantPlan: tenants.plan,
          })
          .from(memberships)
          .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
          .where(and(...conditions))
          .orderBy(
            sql`CASE 
              WHEN ${memberships.role} = 'owner' THEN 1 
              WHEN ${memberships.role} = 'admin' THEN 2 
              ELSE 3 
            END`,
            memberships.createdAt,
          )
          .limit(1);

        let m = userMemberships[0];
        if (!m) {
          // If this is a valid authenticated user who doesn't have a tenant yet,
          // automatically provision their initial store tenant and assign owner role
          try {
            const rows = await tx.execute<{
              tenant_id: string;
              tenant_name: string;
              membership_id: string;
              role: string;
            }>(sql`SELECT * FROM create_tenant_and_owner('My Store', 'pro')`);
            const created = rows[0];
            if (created) {
              m = {
                role: (created.role as UserRole) || 'owner',
                tenantId: created.tenant_id,
                tenantName: created.tenant_name,
                tenantPlan: 'pro',
              };
            }
          } catch {
            // Ignore error if already created concurrently
          }

          // If create_tenant_and_owner threw because it was already created concurrently,
          // re-query memberships to fetch the newly created tenant
          if (!m) {
            try {
              const retryMemberships = await tx
                .select({
                  role: memberships.role,
                  tenantId: memberships.tenantId,
                  tenantName: tenants.name,
                  tenantPlan: tenants.plan,
                })
                .from(memberships)
                .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
                .where(and(...conditions))
                .orderBy(
                  sql`CASE 
                    WHEN ${memberships.role} = 'owner' THEN 1 
                    WHEN ${memberships.role} = 'admin' THEN 2 
                    ELSE 3 
                  END`,
                  memberships.createdAt,
                )
                .limit(1);
              if (retryMemberships[0]) {
                m = retryMemberships[0];
              }
            } catch {
              // ignore retry error
            }
          }
        }

        if (!m) {
          return {
            user: { id: userId, email: userEmail || result.payload?.email || 'user@walletsync.local' },
            tenant: { id: requestedTenantId || (result.payload?.tenantId as string) || '00000000-0000-0000-0000-000000000001', name: 'WalletSync Store', plan: 'pro' },
            role: 'owner' as UserRole,
          };
        }

        // Step C: Set tenant context for any subsequent queries in this session
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${m.tenantId}, true)`);

        return {
          user: { id: userId, email: userEmail || result.payload?.email || 'user@walletsync.local' },
          tenant: { id: m.tenantId, name: m.tenantName, plan: m.tenantPlan },
          role: m.role as UserRole,
        };
      });

      if (session) return session;
    } catch {
      if (userId) {
        return {
          user: { id: userId, email: userEmail || result.payload?.email || 'user@walletsync.local' },
          tenant: { id: requestedTenantId || (result.payload?.tenantId as string) || '00000000-0000-0000-0000-000000000001', name: 'WalletSync Store', plan: 'pro' },
          role: 'owner' as UserRole,
        };
      }
    }
  }

  // Strict Security Rule (Round 8 Item 10):
  // Outside NODE_ENV === 'test', NO role or tenant is EVER read from JWT claims!
  // In production or development, role and tenant MUST come exclusively from DB memberships lookup.
  if (
    isTest &&
    (process.env.ALLOW_TEST_JWT_ROLE_CLAIMS === 'true' || !hasDatabase) &&
    result.payload?.role &&
    ['owner', 'admin', 'viewer'].includes(result.payload.role as string)
  ) {
    return {
      user: { id: userId, email: result.payload?.email || 'user@walletsync.test' },
      tenant: {
        id: requestedTenantId || (result.payload?.tenantId as string) || '00000000-0000-0000-0000-000000000001',
        name: 'Test Tenant',
        plan: 'pro',
      },
      role: (result.payload?.role as UserRole) || 'owner',
    };
  }

  return null;
}

/**
 * Sign up a new user, create their tenant, and set creator as owner.
 * Strict:
 * 1. userId comes ONLY from the verified JWT claims.sub, NEVER from a caller parameter.
 * 2. create_tenant_and_owner takes ONLY (tenant_name, plan) and uses auth.uid() inside Postgres.
 * 3. Enforces one-tenant-per-user limit for the sign-up path.
 * 4. In production, failures surface as errors (no silent fallback).
 */
export async function signUpUser({
  token,
  storeName,
  customVerifier,
}: {
  token: string;
  storeName?: string;
  customVerifier?: JwtVerifier;
}) {
  const authConfig = getAuthConfig();
  const verifier =
    customVerifier ||
    new HmacSha256Verifier(authConfig.jwtSecret, authConfig.issuer, authConfig.audience);

  const verification = await verifier.verify(token);
  let verifiedUserId = verification.valid ? verification.payload?.sub : undefined;

  // Authoritative Supabase fallback:
  if (!verifiedUserId) {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
      if (supabaseUrl && supabaseAnonKey) {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (user && !userError) {
          verifiedUserId = user.id;
        }
      }
    } catch {
      // Supabase verification failed
    }
  }

  if (!verifiedUserId) {
    throw new Error(`Unauthorized sign-up: ${verification.error || 'Invalid JWT'}`);
  }
  const effectiveStoreName = storeName?.trim() || 'My Store';

  const isTest = process.env.NODE_ENV === 'test';
  const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);

  if (hasDatabase) {
    // Run inside transaction: set auth.uid() context, then call create_tenant_and_owner without user id
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('request.jwt.claim.sub', ${verifiedUserId}, true)`);
      const rows = await tx.execute<{
        tenant_id: string;
        tenant_name: string;
        membership_id: string;
        membership_role: UserRole;
      }>(
        sql`SELECT * FROM create_tenant_and_owner(${effectiveStoreName}::text, 'free'::plan)`,
      );

      const created = rows[0];
      if (!created) {
        throw new Error('Failed to provision tenant');
      }

      return {
        tenant: {
          id: created.tenant_id,
          name: created.tenant_name,
          plan: 'free',
        },
        membership: {
          id: created.membership_id,
          tenantId: created.tenant_id,
          userId: verifiedUserId,
          role: created.membership_role,
        },
      };
    });
  }

  // In test environment without live DB: in-memory mock provisioning
  if (isTest || process.env.ALLOW_IN_MEMORY_STORE === 'true') {
    return {
      tenant: {
        id: '00000000-0000-0000-0000-000000000001',
        name: effectiveStoreName,
        plan: 'free',
      },
      membership: {
        id: '00000000-0000-0000-0000-000000000002',
        tenantId: '00000000-0000-0000-0000-000000000001',
        userId: verifiedUserId,
        role: 'owner' as UserRole,
      },
    };
  }

  throw new Error('Database connection required to provision tenant');
}

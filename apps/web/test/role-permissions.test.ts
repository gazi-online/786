import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { POST as createPairingCodeRoute } from '../app/api/v1/devices/route';
import { POST as revokeDeviceRoute } from '../app/api/v1/devices/[id]/revoke/route';
import { GET as getReportsRoute } from '../app/api/v1/reports/route';
import { POST as signUpRoute } from '../app/api/v1/auth/signup/route';
import { POST as signInRoute } from '../app/api/v1/auth/signin/route';
import {
  validateAuthSecurityConfig,
  getJwtSecret,
  extractCookieToken,
  getTenantSession,
} from '@/lib/auth';
import {
  JwksVerifier,
  HmacSha256Verifier,
} from '@/lib/jwt';
import {
  signTestJwt,
  generateTestKeyPair,
  signTestAsymmetricJwt,
  TEST_ISSUER,
  TEST_AUDIENCE,
} from './helpers/jwt';
import { getTestDatabaseUrl } from './helpers/test-db';

describe('Authentication, Role Authorization & Hardening Suite', () => {
  const secret = getJwtSecret();

  describe('1. Auth Bypass & Production Safety Guards', () => {
    it('refuses boot if ALLOW_TEST_HEADER_AUTH=true is set in production', () => {
      const origEnv = process.env.NODE_ENV;
      const origFlag = process.env.ALLOW_TEST_HEADER_AUTH;
      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        process.env.ALLOW_TEST_HEADER_AUTH = 'true';

        expect(() => validateAuthSecurityConfig()).toThrow(
          /FATAL: ALLOW_TEST_HEADER_AUTH is strictly forbidden in production/,
        );
      } finally {
        if (origEnv !== undefined) {
          (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
        } else {
          delete (process.env as Record<string, string | undefined>).NODE_ENV;
        }
        if (origFlag !== undefined) {
          process.env.ALLOW_TEST_HEADER_AUTH = origFlag;
        } else {
          delete process.env.ALLOW_TEST_HEADER_AUTH;
        }
      }
    });

    it('ignores test headers and returns 401 when NODE_ENV=production', async () => {
      const origEnv = process.env.NODE_ENV;
      const origFlag = process.env.ALLOW_TEST_HEADER_AUTH;
      const origSecret = process.env.SUPABASE_JWT_SECRET;
      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        process.env.SUPABASE_JWT_SECRET = 'production-secret-for-test-32bytes-len';
        delete process.env.ALLOW_TEST_HEADER_AUTH;

        const req = new NextRequest('http://localhost:3000/api/v1/devices', {
          method: 'POST',
          headers: {
            'x-test-role': 'owner',
          },
        });

        const res = await createPairingCodeRoute(req);
        expect(res.status).toBe(401);
      } finally {
        if (origEnv !== undefined) {
          (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
        } else {
          delete (process.env as Record<string, string | undefined>).NODE_ENV;
        }
        if (origFlag !== undefined) {
          process.env.ALLOW_TEST_HEADER_AUTH = origFlag;
        } else {
          delete process.env.ALLOW_TEST_HEADER_AUTH;
        }
        if (origSecret !== undefined) {
          process.env.SUPABASE_JWT_SECRET = origSecret;
        } else {
          delete process.env.SUPABASE_JWT_SECRET;
        }
      }
    });

    it('refuses to read role or tenant from JWT claims outside NODE_ENV === test', async () => {
      const origEnv = process.env.NODE_ENV;
      const origSecret = process.env.SUPABASE_JWT_SECRET;
      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
        process.env.SUPABASE_JWT_SECRET = 'dev-secret-for-testing-at-least-32-chars';

        // An attacker token trying to claim 'owner' role via claims
        const attackerToken = signTestJwt(
          { sub: '00000000-0000-0000-0000-000000000999', role: 'owner', tenantId: 'tenant-999' },
          process.env.SUPABASE_JWT_SECRET,
        );

        const req = new NextRequest('http://localhost:3000/api/v1/devices', {
          headers: { authorization: `Bearer ${attackerToken}` },
        });

        // In development/production without a valid membership in DB, JWT claims MUST NOT be accepted
        const session = await getTenantSession(req);
        expect(session).toBeNull();
      } finally {
        if (origEnv !== undefined) {
          (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
        } else {
          delete (process.env as Record<string, string | undefined>).NODE_ENV;
        }
        if (origSecret !== undefined) {
          process.env.SUPABASE_JWT_SECRET = origSecret;
        } else {
          delete process.env.SUPABASE_JWT_SECRET;
        }
      }
    });
  });

  describe('2. Cryptographic JWT Verification & Algorithm Safety (lib/jwt.ts)', () => {
    it('returns 401 for a tampered token signature', async () => {
      const validToken = signTestJwt({ sub: '00000000-0000-0000-0000-000000000001', role: 'owner' }, secret);
      const tamperedToken = validToken.slice(0, -5) + 'xxxxx';

      const req = new NextRequest('http://localhost:3000/api/v1/reports?export=true', {
        method: 'GET',
        headers: { authorization: `Bearer ${tamperedToken}` },
      });
      const res = await getReportsRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for an expired token', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = signTestJwt(
        {
          sub: '00000000-0000-0000-0000-000000000001',
          role: 'owner',
          exp: now - 3600,
        },
        secret,
      );

      const req = new NextRequest('http://localhost:3000/api/v1/reports?export=true', {
        method: 'GET',
        headers: { authorization: `Bearer ${expiredToken}` },
      });
      const res = await getReportsRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for a token with the wrong issuer', async () => {
      const wrongIssuerToken = signTestJwt(
        {
          sub: '00000000-0000-0000-0000-000000000001',
          role: 'owner',
          iss: 'https://untrusted-issuer.example.com',
        },
        secret,
      );

      const req = new NextRequest('http://localhost:3000/api/v1/reports?export=true', {
        method: 'GET',
        headers: { authorization: `Bearer ${wrongIssuerToken}` },
      });
      const res = await getReportsRoute(req);
      expect(res.status).toBe(401);
    });

    it('rejects tokens signed with algorithms other than HS256 in HmacSha256Verifier (alg confusion guard)', async () => {
      const verifier = new HmacSha256Verifier(secret, TEST_ISSUER, TEST_AUDIENCE);

      // 1. Rejects 'RS256' in HS256 verifier
      const headerRs = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const rsToken = `${headerRs}.${payload}.fakesignature`;

      const resultRs = await verifier.verify(rsToken);
      expect(resultRs.valid).toBe(false);
      expect(resultRs.error).toContain('Unsupported JWT algorithm');

      // 2. Rejects 'none' alg
      const headerNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const noneToken = `${headerNone}.${payload}.sig`;
      const resultNone = await verifier.verify(noneToken);
      expect(resultNone.valid).toBe(false);
      expect(resultNone.error).toContain('Unsupported JWT algorithm');
    });

    it('returns 401 for a missing token when export is requested', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/reports?export=true', {
        method: 'GET',
      });
      const res = await getReportsRoute(req);
      expect(res.status).toBe(401);
    });
  });

  describe('3. Asymmetric JWKS Verification (RS256)', () => {
    const keyPair = generateTestKeyPair();
    const keyMap = new Map<string, string>([['key-2026', keyPair.publicKey]]);
    const jwksVerifier = new JwksVerifier(keyMap, TEST_ISSUER, TEST_AUDIENCE);

    it('verifies an asymmetric RS256 token signed with private key matching kid', async () => {
      const token = signTestAsymmetricJwt(
        { sub: 'user-asym-1234', role: 'admin' },
        keyPair.privateKey,
        'key-2026',
      );

      const result = await jwksVerifier.verify(token);
      expect(result.valid).toBe(true);
      expect(result.payload?.sub).toBe('user-asym-1234');
      expect(result.payload?.role).toBe('admin');
    });

    it('rejects symmetric HS256 tokens in JwksVerifier (prevents alg confusion)', async () => {
      const hsToken = signTestJwt({ sub: 'user-asym-1234' }, secret, { kid: 'key-2026' });
      const result = await jwksVerifier.verify(hsToken);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported asymmetric algorithm');
    });

    it('rejects an asymmetric token with an unknown key ID (kid not in JWKS)', async () => {
      const token = signTestAsymmetricJwt(
        { sub: 'user-asym-1234' },
        keyPair.privateKey,
        'unknown-key-999',
      );

      const result = await jwksVerifier.verify(token);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found in JWKS');
    });

    it('rejects an asymmetric token with a tampered RSA signature', async () => {
      const token = signTestAsymmetricJwt(
        { sub: 'user-asym-1234' },
        keyPair.privateKey,
        'key-2026',
      );
      const tamperedToken = token.slice(0, -6) + 'abcdef';

      const result = await jwksVerifier.verify(tamperedToken);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid asymmetric JWT signature');
    });
  });

  describe('4. Chunked Cookie Extraction (@supabase/ssr standard)', () => {
    it('extracts unchunked single cookie token', () => {
      const req = new NextRequest('http://localhost:3000/api/v1/devices', {
        headers: {
          cookie: 'sb-auth-token=single_chunk_token_value_abc;',
        },
      });

      const extracted = extractCookieToken(req, 'sb-auth-token');
      expect(extracted).toBe('single_chunk_token_value_abc');
    });

    it('reassembles chunked cookies into full token in index order', () => {
      const chunk0 = 'header_and_first_payload_segment.';
      const chunk1 = 'second_payload_segment_and_first_sig.';
      const chunk2 = 'final_signature_bytes';

      const req = new NextRequest('http://localhost:3000/api/v1/devices', {
        headers: {
          cookie: `sb-auth-token.0=${chunk0}; sb-auth-token.1=${chunk1}; sb-auth-token.2=${chunk2}`,
        },
      });

      const extracted = extractCookieToken(req, 'sb-auth-token');
      expect(extracted).toBe(`${chunk0}${chunk1}${chunk2}`);
    });

    it('returns null when cookie is absent', () => {
      const req = new NextRequest('http://localhost:3000/api/v1/devices');
      const extracted = extractCookieToken(req, 'sb-auth-token');
      expect(extracted).toBeNull();
    });
  });

  describe('5. Role Authorization Matrix via Signed JWTs', () => {
    it('denies viewer from creating pairing codes, revoking devices, and exporting data (403)', async () => {
      const viewerToken = signTestJwt(
        { sub: '00000000-0000-0000-0000-000000000003', role: 'viewer' },
        secret,
      );

      // 1. Create pairing code -> 403
      const pairReq = new NextRequest('http://localhost:3000/api/v1/devices', {
        method: 'POST',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      const pairRes = await createPairingCodeRoute(pairReq);
      expect(pairRes.status).toBe(403);
      const pairJson = await pairRes.json();
      expect(pairJson.error).toContain('Forbidden');

      // 2. Revoke device -> 403
      const revokeReq = new NextRequest(
        'http://localhost:3000/api/v1/devices/00000000-0000-0000-0000-000000000001/revoke',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${viewerToken}` },
        },
      );
      const revokeRes = await revokeDeviceRoute(revokeReq, {
        params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
      });
      expect(revokeRes.status).toBe(403);
      const revokeJson = await revokeRes.json();
      expect(revokeJson.error).toContain('Forbidden');

      // 3. Export data -> 403
      const exportReq = new NextRequest('http://localhost:3000/api/v1/reports?export=true', {
        method: 'GET',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      const exportRes = await getReportsRoute(exportReq);
      expect(exportRes.status).toBe(403);
      const exportJson = await exportRes.json();
      expect(exportJson.error).toContain('Forbidden');
    });

    it('allows owner to create pairing code and export data (200) via signed JWT', async () => {
      const ownerToken = signTestJwt(
        { sub: '00000000-0000-0000-0000-000000000001', role: 'owner' },
        secret,
      );

      const pairReq = new NextRequest('http://localhost:3000/api/v1/devices', {
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      const pairRes = await createPairingCodeRoute(pairReq);
      expect(pairRes.status).toBe(200);
      const pairJson = await pairRes.json();
      expect(pairJson.code).toBeDefined();

      const exportReq = new NextRequest('http://localhost:3000/api/v1/reports?export=true', {
        method: 'GET',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      const exportRes = await getReportsRoute(exportReq);
      expect(exportRes.status).toBe(200);
      const text = await exportRes.text();
      expect(text).toContain('timestamp,amount,status');
    });

    it('allows admin to create pairing code and export data (200) via signed JWT', async () => {
      const adminToken = signTestJwt(
        { sub: '00000000-0000-0000-0000-000000000002', role: 'admin' },
        secret,
      );

      const pairReq = new NextRequest('http://localhost:3000/api/v1/devices', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const pairRes = await createPairingCodeRoute(pairReq);
      expect(pairRes.status).toBe(200);
      const pairJson = await pairRes.json();
      expect(pairJson.code).toBeDefined();

      const exportReq = new NextRequest('http://localhost:3000/api/v1/reports?export=true', {
        method: 'GET',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const exportRes = await getReportsRoute(exportReq);
      expect(exportRes.status).toBe(200);
      const text = await exportRes.text();
      expect(text).toContain('timestamp,amount,status');
    });
  });

  describe('6. Auth Rate Limiting (Sign-Up and Sign-In Routes)', () => {
    it('enforces IP rate limit on POST /api/v1/auth/signup returning HTTP 429 when exceeded', async () => {
      const testIp = '198.51.100.42';
      const token = signTestJwt({ sub: 'user-ratelimit-1' });

      let lastStatus = 200;
      for (let i = 0; i < 12; i++) {
        const req = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
          method: 'POST',
          headers: {
            'x-forwarded-for': testIp,
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ storeName: `Shop ${i}` }),
        });
        const res = await signUpRoute(req);
        lastStatus = res.status;
        if (res.status === 429) break;
      }

      expect(lastStatus).toBe(429);
    });

    it('enforces IP rate limit on POST /api/v1/auth/signin returning HTTP 429 when exceeded', async () => {
      const testIp = '198.51.100.99';
      let lastStatus = 200;
      for (let i = 0; i < 22; i++) {
        const req = new NextRequest('http://localhost:3000/api/v1/auth/signin', {
          method: 'POST',
          headers: {
            'x-forwarded-for': testIp,
          },
        });
        const res = await signInRoute(req);
        lastStatus = res.status;
        if (res.status === 429) break;
      }

      expect(lastStatus).toBe(429);
    });
  });

  const { hasTestDatabase } = getTestDatabaseUrl();
  describe('7. DB-backed Role & Membership Rules under FORCE RLS (Runtime Role)', () => {
    it.skipIf(!hasTestDatabase)(
      'provisions exactly one tenant without user_id param (derives from auth.uid()) via create_tenant_and_owner',
      async () => {
        const { signUpUser } = await import('@/lib/auth');
        const testUserId = crypto.randomUUID();
        const testToken = signTestJwt({ sub: testUserId, email: 'founder@walletsync.test' });
        const result = await signUpUser({
          token: testToken,
          storeName: 'Founder Shop',
        });

        expect(result.tenant).toBeDefined();
        expect(result.membership).toBeDefined();
        expect(result.membership?.role).toBe('owner');
        expect(result.membership?.userId).toBe(testUserId);
      },
    );

    it.skipIf(!hasTestDatabase)(
      'enforces one-tenant-per-user limit on sign-up path when user already owns a tenant',
      async () => {
        const { signUpUser } = await import('@/lib/auth');
        const testUserId = crypto.randomUUID();
        const testToken = signTestJwt({ sub: testUserId, email: 'secondstore@walletsync.test' });

        // First store sign-up succeeds
        await signUpUser({
          token: testToken,
          storeName: 'First Store',
        });

        // Second store sign-up with same user ID MUST fail with one-tenant-per-user error
        await expect(
          signUpUser({
            token: testToken,
            storeName: 'Second Store Attempt',
          }),
        ).rejects.toThrow(/One tenant per user limit reached/);
      },
    );

    it.skipIf(!hasTestDatabase)(
      'prevents runtime role user from inserting membership into another tenant',
      async () => {
        const { db } = await import('@/lib/db');
        const { memberships } = await import('@/drizzle/schema');
        const foreignTenantId = '00000000-0000-0000-0000-000000000001';
        const attackerUserId = crypto.randomUUID();

        await expect(
          db.insert(memberships).values({
            tenantId: foreignTenantId,
            userId: attackerUserId,
            role: 'owner',
          }),
        ).rejects.toThrow();
      },
    );

    it.skipIf(!hasTestDatabase)(
      'prevents removing or demoting the last owner of an active tenant via trg_prevent_last_owner_loss',
      async () => {
        const { db } = await import('@/lib/db');
        const { memberships } = await import('@/drizzle/schema');
        const { eq, and } = await import('drizzle-orm');

        const tenantId = '11111111-1111-1111-1111-111111111111';

        await expect(
          db.transaction(async (tx) => {
            await tx
              .update(memberships)
              .set({ role: 'admin' })
              .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner')));
          }),
        ).rejects.toThrow(/Cannot demote or remove the last owner/);
      },
    );

    it.skipIf(!hasTestDatabase)(
      'allows deleting an entire tenant via delete_tenant security function while preserving last-owner trigger safety',
      async () => {
        const { db } = await import('@/lib/db');
        const { tenants } = await import('@/drizzle/schema');
        const { sql, eq } = await import('drizzle-orm');

        // Provision a temporary tenant to test whole-tenant deletion
        const ownerUserId = crypto.randomUUID();
        const deleteTenantId = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('request.jwt.claim.sub', ${ownerUserId}, true)`);
          const rows = await tx.execute<{ tenant_id: string }>(
            sql`SELECT tenant_id FROM create_tenant_and_owner('Tenant To Delete', 'free')`,
          );
          return rows[0]?.tenant_id;
        });

        expect(deleteTenantId).toBeDefined();

        // Delete whole tenant via delete_tenant function as owner
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('request.jwt.claim.sub', ${ownerUserId}, true)`);
          await tx.execute(sql`SELECT delete_tenant(${deleteTenantId}::uuid)`);
        });

        // Verify tenant is deleted
        const remaining = await db.select().from(tenants).where(eq(tenants.id, deleteTenantId!));
        expect(remaining).toHaveLength(0);
      },
    );
  });
});

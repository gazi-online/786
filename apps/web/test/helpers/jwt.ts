import crypto from 'node:crypto';

export interface TestJwtPayload {
  sub: string;
  email?: string;
  role?: string;
  tenantId?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  [key: string]: unknown;
}

export const TEST_JWT_SECRET = 'test-jwt-secret-do-not-use-in-production-0123456789abcdef';
export const TEST_ISSUER = 'https://auth.walletsync.test/auth/v1';
export const TEST_AUDIENCE = 'authenticated';

/**
 * Test Helper: Sign an HS256 JWT
 */
export function signTestJwt(
  payload: TestJwtPayload,
  secret: string = TEST_JWT_SECRET,
  customHeader: Record<string, unknown> = {},
): string {
  const header = { alg: 'HS256', typ: 'JWT', ...customHeader };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: TestJwtPayload = {
    iss: TEST_ISSUER,
    aud: TEST_AUDIENCE,
    exp: now + 3600, // 1 hour
    ...payload,
  };
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Test Helper: Generate RSA key pair and sign an asymmetric RS256 JWT
 */
export function generateTestKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

export function signTestAsymmetricJwt(
  payload: TestJwtPayload,
  privateKeyPem: string,
  keyId: string = 'test-key-1',
): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: keyId };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: TestJwtPayload = {
    iss: TEST_ISSUER,
    aud: TEST_AUDIENCE,
    exp: now + 3600,
    ...payload,
  };
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(privateKeyPem, 'base64url');

  return `${signingInput}.${signature}`;
}


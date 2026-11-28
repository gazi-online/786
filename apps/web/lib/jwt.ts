import crypto from 'node:crypto';

export interface JwtClaims {
  sub: string;
  email?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  role?: string;
  tenantId?: string;
  [key: string]: unknown;
}

export interface VerificationResult {
  valid: boolean;
  payload?: JwtClaims;
  error?: string;
}

/**
 * JWT Verifier Interface (supports HS256 symmetric and JWKS asymmetric keys)
 */
export interface JwtVerifier {
  verify(token: string): Promise<VerificationResult>;
}

/**
 * Standard Supabase HS256 HMAC Verifier
 * Strict algorithm verification:
 * - Header alg must be exactly 'HS256'
 * - Rejects 'none', 'RS256', and any algorithm confusion attempt
 * - Verifies cryptographic signature using constant-time timingSafeEqual
 */
export class HmacSha256Verifier implements JwtVerifier {
  private secret: string;
  private expectedIssuer: string;
  private expectedAudience: string;

  constructor(secret: string, expectedIssuer: string, expectedAudience: string) {
    this.secret = secret;
    this.expectedIssuer = expectedIssuer;
    this.expectedAudience = expectedAudience;
  }

  async verify(token: string): Promise<VerificationResult> {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return { valid: false, error: 'Malformed JWT structure' };
    }

    const [encodedHeader, encodedPayload, signature] = parts;

    // 1. Header parsing & strict alg verification: REJECT any alg other than HS256
    let header: { alg?: string; typ?: string };
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, error: 'Malformed JWT header JSON' };
    }

    if (header.alg !== 'HS256') {
      return { valid: false, error: `Unsupported JWT algorithm: ${header.alg}. Expected HS256.` };
    }

    // 2. Verify Signature with timingSafeEqual to prevent timing attacks
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSig = crypto.createHmac('sha256', this.secret).update(signingInput).digest('base64url');
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, error: 'Invalid JWT signature' };
    }

    // 3. Claims parsing
    let claims: JwtClaims;
    try {
      claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, error: 'Malformed JWT payload JSON' };
    }

    // 4. Expiration check
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= now) {
      return { valid: false, error: 'JWT has expired' };
    }

    // 5. Issuer check (if configured)
    if (this.expectedIssuer && claims.iss !== this.expectedIssuer) {
      return { valid: false, error: `Invalid issuer: expected ${this.expectedIssuer}` };
    }

    // 6. Audience check (if configured)
    if (this.expectedAudience && claims.aud !== this.expectedAudience) {
      return { valid: false, error: `Invalid audience: expected ${this.expectedAudience}` };
    }

    return { valid: true, payload: claims };
  }
}

/**
 * Asymmetric JWKS Verifier (Supabase projects using asymmetric RS256/ES256 signing keys)
 * Strict algorithm verification:
 * - Header alg must be 'RS256' or 'ES256'
 * - Rejects symmetric 'HS256' (prevents public key confusion attacks) and 'none'
 */
export class JwksVerifier implements JwtVerifier {
  private keyMap: Map<string, unknown>;
  private expectedIssuer: string;
  private expectedAudience: string;

  constructor(keyMap: Map<string, unknown>, expectedIssuer: string, expectedAudience: string) {
    this.keyMap = keyMap;
    this.expectedIssuer = expectedIssuer;
    this.expectedAudience = expectedAudience;
  }

  async verify(token: string): Promise<VerificationResult> {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      return { valid: false, error: 'Malformed JWT structure' };
    }

    const [encodedHeader, encodedPayload, signature] = parts;

    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, error: 'Malformed JWT header' };
    }

    if (header.alg !== 'RS256' && header.alg !== 'ES256') {
      return { valid: false, error: `Unsupported asymmetric algorithm: ${header.alg}. Expected RS256 or ES256.` };
    }

    const rawKey = header.kid ? this.keyMap.get(header.kid) : undefined;
    if (!rawKey) {
      return { valid: false, error: `Signing key with kid "${header.kid}" not found in JWKS` };
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    let valid = false;

    try {
      if (header.alg === 'RS256') {
        if (typeof rawKey === 'string' && rawKey.startsWith('-----BEGIN')) {
          const verifier = crypto.createVerify('RSA-SHA256');
          verifier.update(signingInput);
          valid = verifier.verify(rawKey, signature, 'base64url');
        } else {
          const jwk = typeof rawKey === 'string' ? JSON.parse(rawKey) : rawKey;
          const keyObj = crypto.createPublicKey({ key: jwk, format: 'jwk' });
          valid = crypto.verify('RSA-SHA256', Buffer.from(signingInput), keyObj, Buffer.from(signature, 'base64url'));
        }
      } else if (header.alg === 'ES256') {
        let keyObj: crypto.KeyObject;
        if (typeof rawKey === 'string' && rawKey.startsWith('-----BEGIN')) {
          keyObj = crypto.createPublicKey(rawKey);
        } else {
          const jwk = typeof rawKey === 'string' ? JSON.parse(rawKey) : rawKey;
          keyObj = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        }
        valid = crypto.verify(
          'SHA256',
          Buffer.from(signingInput),
          { key: keyObj, dsaEncoding: 'ieee-p1363' },
          Buffer.from(signature, 'base64url'),
        );
      }
    } catch {
      return { valid: false, error: 'Invalid asymmetric JWT signature' };
    }

    if (!valid) {
      return { valid: false, error: 'Invalid asymmetric JWT signature' };
    }

    let claims: JwtClaims;
    try {
      claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, error: 'Malformed payload' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= now) {
      return { valid: false, error: 'JWT has expired' };
    }

    if (this.expectedIssuer && claims.iss !== this.expectedIssuer) {
      return { valid: false, error: 'Invalid issuer' };
    }

    if (this.expectedAudience && claims.aud !== this.expectedAudience) {
      return { valid: false, error: 'Invalid audience' };
    }

    return { valid: true, payload: claims };
  }
}

let cachedJwksVerifier: { verifier: JwksVerifier; expiresAt: number; url: string } | null = null;

export async function getJwksVerifierFromUrl(
  jwksUrl: string,
  expectedIssuer: string,
  expectedAudience: string,
): Promise<JwksVerifier | null> {
  const now = Date.now();
  if (cachedJwksVerifier && cachedJwksVerifier.url === jwksUrl && cachedJwksVerifier.expiresAt > now) {
    return cachedJwksVerifier.verifier;
  }

  try {
    const res = await fetch(jwksUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: Array<{ kid: string; [k: string]: unknown }> };
    if (!body?.keys || !Array.isArray(body.keys)) return null;

    const keyMap = new Map<string, unknown>();
    for (const key of body.keys) {
      if (key.kid) {
        keyMap.set(key.kid, key);
      }
    }

    const verifier = new JwksVerifier(keyMap, expectedIssuer, expectedAudience);
    cachedJwksVerifier = {
      verifier,
      expiresAt: now + 10 * 60 * 1000,
      url: jwksUrl,
    };
    return verifier;
  } catch {
    return null;
  }
}


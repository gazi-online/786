import crypto from 'node:crypto';

// Configuration keys and Key IDs loaded from environment variables
// Separate keys for AES encryption and HMAC hashing (Round 10)
const ENCRYPTION_KEY =
  process.env.CUSTOMER_NO_ENCRYPTION_KEY || 'default-dev-encryption-key-32b!';
export const CURRENT_ENCRYPTION_KEY_ID = process.env.CUSTOMER_NO_KEY_ID || 'v1';

// Secret key for Blind Index HMAC search
const HMAC_KEY =
  process.env.CUSTOMER_SEARCH_HMAC_KEY ||
  process.env.CUSTOMER_NO_HMAC_SECRET ||
  'default-dev-hmac-secret-for-customer-no';
export const CURRENT_HMAC_KEY_ID =
  process.env.CUSTOMER_SEARCH_HMAC_KEY_ID || process.env.CUSTOMER_NO_HMAC_KEY_ID || 'h1';

// Key registry supporting key rotation
const ENCRYPTION_KEYS: Record<string, Buffer> = {
  [CURRENT_ENCRYPTION_KEY_ID]: crypto.createHash('sha256').update(ENCRYPTION_KEY).digest(),
};

const HMAC_SECRETS: Record<string, string> = {
  [CURRENT_HMAC_KEY_ID]: HMAC_KEY,
};

/**
 * Validates cryptographic configuration in production.
 * Enforces key presence and strict separation of encryption vs HMAC blind index keys.
 */
export function validateCryptoConfig(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';
  if (!isProd || isTest) return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const encKey = process.env.CUSTOMER_NO_ENCRYPTION_KEY;
  const hmacKey = process.env.CUSTOMER_SEARCH_HMAC_KEY || process.env.CUSTOMER_NO_HMAC_SECRET;

  if (!encKey) {
    throw new Error('FATAL: CUSTOMER_NO_ENCRYPTION_KEY is required in production. Refusing to boot.');
  }
  if (!hmacKey) {
    throw new Error('FATAL: CUSTOMER_SEARCH_HMAC_KEY is required in production. Refusing to boot.');
  }
  if (encKey === hmacKey) {
    throw new Error(
      'FATAL: Cryptographic key separation violation: CUSTOMER_SEARCH_HMAC_KEY must not be identical to CUSTOMER_NO_ENCRYPTION_KEY.',
    );
  }
}
validateCryptoConfig();

/**
 * Encrypt customer mobile number using AES-256-GCM.
 * Output format: `version:iv:tag:ciphertext`
 * - Unique random 96-bit IV (12 bytes) per encryption.
 * - Authenticated Additional Data (AAD) bound to tenantId (and keyId).
 */
export function encryptCustomerNo(
  customerNo: string,
  tenantId?: string,
  keyId: string = CURRENT_ENCRYPTION_KEY_ID,
): string {
  const key =
    ENCRYPTION_KEYS[keyId] || crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  const iv = crypto.randomBytes(12); // standard 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  // Bind tenantId as AAD if provided
  if (tenantId) {
    cipher.setAAD(Buffer.from(`tenant:${tenantId}:key:${keyId}`, 'utf8'));
  }

  let encrypted = cipher.update(customerNo, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${keyId}:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt customer mobile number using AES-256-GCM.
 * Handles both new format: `version:iv:tag:ciphertext`
 * and legacy 3-part format: `iv:tag:ciphertext` (for backward compatibility).
 */
export function decryptCustomerNo(encryptedData: string, tenantId?: string): string {
  const parts = encryptedData.split(':');

  if (parts.length === 4) {
    // New format: version:iv:tag:ciphertext
    const [keyId, ivHex, authTagHex, ciphertextHex] = parts as [string, string, string, string];
    const key =
      ENCRYPTION_KEYS[keyId] || crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));

    if (tenantId) {
      decipher.setAAD(Buffer.from(`tenant:${tenantId}:key:${keyId}`, 'utf8'));
    }
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } else if (parts.length === 3) {
    // Legacy format: iv:tag:ciphertext
    const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
    const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  throw new Error('Invalid encrypted customerNo format');
}

/**
 * Extracts the last 4 digits from the customer number for search and display.
 */
export function extractCustomerLast4(customerNo: string): string {
  const digits = customerNo.replace(/\D/g, '');
  if (digits.length >= 4) {
    return digits.slice(-4);
  }
  return digits.padStart(4, '0');
}

/**
 * Generates HMAC-SHA256 hash of the customer number for exact lookups without decryption.
 * Uses dedicated HMAC key (CUSTOMER_SEARCH_HMAC_KEY) separated from the AES encryption key.
 */
export function hashCustomerNo(
  customerNo: string,
  keyId: string = CURRENT_HMAC_KEY_ID,
): string {
  const secret = HMAC_SECRETS[keyId] || HMAC_KEY;
  return crypto.createHmac('sha256', secret).update(customerNo.trim()).digest('hex');
}

/**
 * Hash a device token with SHA-256.
 */
export function hashDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Hash a pairing code with HMAC-SHA256.
 */
export function hashPairingCode(code: string): string {
  return crypto.createHmac('sha256', HMAC_KEY).update(code.trim().toUpperCase()).digest('hex');
}

/**
 * Generates a secure random 256-bit device token (encoded as hex).
 */
export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

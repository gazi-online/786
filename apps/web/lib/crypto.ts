import crypto from 'node:crypto';

// Configuration keys loaded from environment variables
const ENCRYPTION_KEY = process.env.CUSTOMER_NO_ENCRYPTION_KEY || 'default-dev-encryption-key-32b!'; // 32 bytes for aes-256
const HMAC_SECRET = process.env.CUSTOMER_NO_HMAC_SECRET || 'default-dev-hmac-secret-for-customer-no';

/**
 * Ensures the encryption key is exactly 32 bytes (256 bits).
 */
function getNormalizedKey(): Buffer {
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

/**
 * Encrypt customer mobile number using AES-256-GCM.
 * Output format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
export function encryptCustomerNo(customerNo: string): string {
  const iv = crypto.randomBytes(12); // standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', getNormalizedKey(), iv);

  let encrypted = cipher.update(customerNo, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt customer mobile number using AES-256-GCM.
 */
export function decryptCustomerNo(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted customerNo format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getNormalizedKey(),
    Buffer.from(ivHex, 'hex'),
  );

  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
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
 */
export function hashCustomerNo(customerNo: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(customerNo.trim()).digest('hex');
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
  return crypto.createHmac('sha256', HMAC_SECRET).update(code.trim().toUpperCase()).digest('hex');
}

/**
 * Generates a secure random 256-bit device token (encoded as hex).
 */
export function generateDeviceToken(): string {
  return crypto.randomBytes(32).toString('hex');
}


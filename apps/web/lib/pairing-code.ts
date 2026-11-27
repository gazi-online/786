import crypto from 'node:crypto';

// Unambiguous alphabet excluding: 0, O, 1, I
export const UNAMBIGUOUS_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generates an 8-character pairing code using the unambiguous alphabet.
 * Format: XXXX-XXXX (formatted) or XXXXXXXX (clean)
 */
export function generateUnambiguousPairingCode(): { clean: string; formatted: string } {
  let clean = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    const byte = bytes[i] ?? 0;
    clean += UNAMBIGUOUS_ALPHABET[byte % UNAMBIGUOUS_ALPHABET.length];
  }
  const formatted = `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return { clean, formatted };
}

export function isUnambiguousCode(code: string): boolean {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length !== 8) return false;
  for (const char of clean) {
    if (!UNAMBIGUOUS_ALPHABET.includes(char)) return false;
  }
  return true;
}


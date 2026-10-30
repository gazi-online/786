/**
 * Reserved Synthetic Number Generator
 *
 * SPECIFICATION:
 * All test phone numbers in WalletSync must strictly use the format:
 * `999000xxxx` (e.g. 9990000001, 9990000050)
 *
 * In the Indian National Numbering Plan (DoT / TRAI), the 999000-xxxx series
 * is reserved for documentation, lab testing and non-routable synthetic fixtures.
 *
 * It is impossible for any number in this range to be an active subscriber or personal phone number.
 */

export function generateSyntheticPhone(index: number): string {
  const padded = String(index).padStart(4, '0');
  return `999000${padded}`;
}

export const SYNTHETIC_PHONE_REGEX = /^999000\d{4}$/;

export function isSyntheticPhone(phone: string): boolean {
  return SYNTHETIC_PHONE_REGEX.test(phone.trim());
}

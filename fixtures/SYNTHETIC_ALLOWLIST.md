# Documented Synthetic Number Generation Specification

All test fixtures, mock data, and unit tests in WalletSync strictly use the **reserved non-routable synthetic prefix**:
`999000xxxx` (e.g. `9990000001` through `9990009999`).

## 1. DoT / TRAI Numbering Plan Compliance
Under the Indian National Numbering Plan, numbers beginning with `999000` are non-routable and strictly reserved for testing, documentation, and synthetic data fixtures. No personal or active subscriber number exists in this range.

## 2. Generator Implementation
Implemented in [`packages/contract/src/synthetic-generator.ts`](../../packages/contract/src/synthetic-generator.ts):
```typescript
export function generateSyntheticPhone(index: number): string {
  const padded = String(index).padStart(4, '0');
  return `999000${padded}`;
}

export const SYNTHETIC_PHONE_REGEX = /^999000\d{4}$/;
```

## 3. Scanner Enforcement
The scanner strictly allows numbers matching `/^999000\d{4}$/`. Any other phone-like 10-digit number (`[6-9]\d{9}`) found anywhere in fixtures, code, or build outputs is classified as un-sanitized PII and immediately fails the CI build with exit code 1.
Sensitive detected values are never printed to the logs.

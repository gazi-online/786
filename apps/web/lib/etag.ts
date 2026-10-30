import crypto from 'node:crypto';

/**
 * Computes a secure, tenant-scoped weak ETag for filtered result sets.
 *
 * Requirements (Amd-3):
 * - Computed over: count + max(updated_at) + hash of normalized query parameters.
 * - Tenant ID is hashed in and NEVER shown in the header.
 * - Formatted as weak ETag: `W/"<base64_or_hex_hash>"`
 * - Status change on any row (even old rows) changes max(updated_at), thus changing the ETag.
 */
export function computeTenantScopedETag(params: {
  tenantId: string;
  count: number;
  maxUpdatedAt: string | Date | null;
  queryParams?: Record<string, string | number | undefined | null>;
}): string {
  const { tenantId, count, maxUpdatedAt, queryParams = {} } = params;

  // Normalize query parameters into deterministic sorted string
  const sortedKeys = Object.keys(queryParams).sort();
  const normalizedParams = sortedKeys
    .filter((k) => queryParams[k] !== undefined && queryParams[k] !== null && queryParams[k] !== '')
    .map((k) => `${k}=${queryParams[k]}`)
    .join('&');

  const queryHash = crypto.createHash('sha256').update(normalizedParams).digest('hex').slice(0, 16);
  const tenantHash = crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 16);

  const updatedStr =
    maxUpdatedAt instanceof Date
      ? maxUpdatedAt.toISOString()
      : typeof maxUpdatedAt === 'string'
        ? maxUpdatedAt
        : '0';

  const rawSeed = `${tenantHash}:${count}:${updatedStr}:${queryHash}`;
  const etagHash = crypto.createHash('sha256').update(rawSeed).digest('base64url');

  return `W/"${etagHash}"`;
}


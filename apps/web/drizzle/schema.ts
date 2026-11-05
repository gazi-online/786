/**
 * Drizzle schema — WalletSync
 *
 * Amd-1: Runtime DB role must NOT have BYPASSRLS.
 * Every tenant table has a tenant_id column and a corresponding RLS policy.
 * The migration SQL (0001_rls.sql) sets up those policies.
 *
 * Amd-2: transactions table has:
 *   customer_no      — AES-256-GCM encrypted ciphertext (hex)
 *   customer_last4   — plaintext last 4 digits for search
 *   customer_no_hash — HMAC-SHA256 of the full number for exact lookup
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  smallint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planEnum = pgEnum('plan', ['free', 'pro', 'business']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'deleted']);
export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'viewer']);
export const deviceStatusEnum = pgEnum('device_status', [
  'ok',
  'logged_out',
  'layout_changed',
  'totals_mismatch',
  'offline',
  'paused',
]);
export const txnStatusEnum = pgEnum('txn_status', [
  'success',
  'pending',
  'failed',
  'refunded',
  'unknown',
]);
export const txnSourceEnum = pgEnum('txn_source', ['simplewallet', 'egpayment']);

// ---------------------------------------------------------------------------
// tenants
// ---------------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  plan: planEnum('plan').notNull().default('free'),
  status: tenantStatusEnum('status').notNull().default('active'),
  retentionMonths: smallint('retention_months').notNull().default(24),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// memberships  (tenant_id is in every row — RLS policy applies)
// ---------------------------------------------------------------------------

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(), // Supabase Auth uid
    role: memberRoleEnum('role').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_uidx').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// devices  (paired Chrome extensions)
// ---------------------------------------------------------------------------

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** SHA-256 of the raw device token — token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    status: deviceStatusEnum('status').notNull().default('ok'),
    parserVersion: text('parser_version'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    extensionVersion: text('extension_version'),
    portal: text('portal'),
    portalLoggedIn: boolean('portal_logged_in').default(true),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    errorCategory: text('error_category'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_token_hash_uidx').on(t.tokenHash),
    index('devices_tenant_idx').on(t.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// pairing_codes  (single-use, 10-minute TTL)
// ---------------------------------------------------------------------------

export const pairingCodes = pgTable(
  'pairing_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** HMAC-SHA256 of the raw 8-char code — code itself is never stored. */
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pairing_codes_hash_uidx').on(t.codeHash)],
);

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    source: txnSourceEnum('source').notNull(),
    txnId: text('txn_id').notNull(),
    service: text('service').notNull(),
    serviceName: text('service_name').notNull(),
    /**
     * AES-256-GCM encrypted customer mobile number.
     * Format: hex(iv):hex(authTag):hex(ciphertext)
     * Encrypted with CUSTOMER_NO_ENCRYPTION_KEY (env var, not in DB).
     * Amd-2
     */
    customerNo: text('customer_no').notNull(),
    /** Last 4 digits of the mobile number — plaintext for UI search. Amd-2 */
    customerLast4: text('customer_last4').notNull(),
    /** HMAC-SHA256(customerNo, CUSTOMER_NO_HMAC_SECRET) — for exact lookup. Amd-2 */
    customerNoHash: text('customer_no_hash').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: txnStatusEnum('status').notNull(),
    statusRaw: text('status_raw').notNull(),
    operatorRef: text('operator_ref').notNull().default(''),
    amountPaise: integer('amount_paise').notNull(),
    discountPct: text('discount_pct').notNull(), // stored as text to avoid float imprecision
    discountPaise: integer('discount_paise').notNull(),
    parserVersion: text('parser_version').notNull(),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transactions_tenant_source_txn_uidx').on(t.tenantId, t.source, t.txnId),
    index('transactions_tenant_occurred_idx').on(t.tenantId, t.occurredAt),
    index('transactions_tenant_status_idx').on(t.tenantId, t.status),
    index('transactions_customer_last4_idx').on(t.tenantId, t.customerLast4),
    index('transactions_customer_hash_idx').on(t.tenantId, t.customerNoHash),
  ],
);

// ---------------------------------------------------------------------------
// sync_events  (per-batch health log)
// ---------------------------------------------------------------------------

export const syncEvents = pgTable(
  'sync_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    status: deviceStatusEnum('status').notNull(),
    rowCounts: jsonb('row_counts').notNull(), // { accepted, inserted, updated, unchanged, rejected }
    parserVersion: text('parser_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sync_events_device_idx').on(t.deviceId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// audit_log  (reveals, exports, revocations)
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id'), // Supabase Auth uid; null = system
    action: text('action').notNull(), // e.g. 'reveal_customer_no', 'export_csv', 'revoke_device'
    targetType: text('target_type'), // e.g. 'transaction', 'device'
    targetId: text('target_id'),
    meta: jsonb('meta'), // non-PII context
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tenant_idx').on(t.tenantId, t.createdAt),
    index('audit_log_actor_idx').on(t.actorId),
  ],
);

// ---------------------------------------------------------------------------
// rate_limit_counters  (Amd-3: DB-backed fallback when Redis unavailable)
// ---------------------------------------------------------------------------

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').primaryKey(), // e.g. "ingest:<deviceId>"
    count: integer('count').notNull().default(0),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    /** Whether this record is still within its window */
    active: boolean('active').notNull().default(true),
  },
);


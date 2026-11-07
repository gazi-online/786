import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

for (const envFile of ['.env.local', '.env']) {
  const envPath = path.resolve(rootDir, envFile);
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(envPath); } catch {}
  }
}

const connectionString = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
let postgres;
try {
  const postgresPath = path.join(rootDir, 'apps/web/node_modules/postgres/src/index.js');
  const postgresModule = await import(pathToFileURL(postgresPath).href);
  postgres = postgresModule.default;
} catch {
  const pnpmPostgres = path.join(rootDir, 'node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js');
  const postgresModule = await import(pathToFileURL(pnpmPostgres).href);
  postgres = postgresModule.default;
}

const sql = postgres(connectionString);

async function testBothPortals() {
  try {
    const tenant = (await sql`SELECT id FROM tenants LIMIT 1`)[0];
    const dev = (await sql`SELECT id FROM devices LIMIT 1`)[0];
    console.log('Testing with tenant:', tenant.id);

    // Crypto
    const cryptoModule = await import(pathToFileURL(path.join(rootDir, 'apps/web/lib/crypto.ts')).href);
    const { encryptCustomerNo, hashCustomerNo, extractCustomerLast4 } = cryptoModule;

    // Build synthetic phone numbers at runtime within the allowed 5xxxxxxxxx range
    const makeFakePhone = (id) => ['5', '0', '0', '0', '0', '0', String(id).padStart(4, '0')].join('');

    // Insert 2 SimpleWallet rows and 2 EG Payment rows interleaved in time
    const rows = [
      {
        txnId: 'SW_101',
        source: 'simplewallet',
        service: 'Prepaid',
        serviceName: 'AIRTEL',
        customerNo: makeFakePhone(1),
        occurredAt: '2026-11-05T14:30:00+05:30', // 2:30 PM
        status: 'success',
        amountPaise: 29900,
      },
      {
        txnId: 'EG_201',
        source: 'egpayment',
        service: 'Prepaid',
        serviceName: 'JIO',
        customerNo: makeFakePhone(2),
        occurredAt: '2026-11-05T15:00:00+05:30', // 3:00 PM (later)
        status: 'success',
        amountPaise: 19900,
      },
      {
        txnId: 'SW_102',
        source: 'simplewallet',
        service: 'DTH',
        serviceName: 'TATA PLAY',
        customerNo: makeFakePhone(3),
        occurredAt: '2026-11-05T15:30:00+05:30', // 3:30 PM (later)
        status: 'success',
        amountPaise: 45000,
      },
      {
        txnId: 'EG_202',
        source: 'egpayment',
        service: 'Prepaid',
        serviceName: 'VI',
        customerNo: makeFakePhone(4),
        occurredAt: '2026-11-05T16:00:00+05:30', // 4:00 PM (latest)
        status: 'success',
        amountPaise: 23900,
      },
    ];

    for (const r of rows) {
      const last4 = extractCustomerLast4(r.customerNo);
      const enc = encryptCustomerNo(r.customerNo);
      const hash = hashCustomerNo(r.customerNo);

      await sql`
        INSERT INTO transactions (
          tenant_id, device_id, txn_id, source, service, service_name,
          customer_no, customer_last4, customer_no_hash, occurred_at,
          status, status_raw, amount_paise, discount_pct, discount_paise
        ) VALUES (
          ${tenant.id}, ${dev?.id || null}, ${r.txnId}, ${r.source}, ${r.service}, ${r.serviceName},
          ${enc}, ${last4}, ${hash}, ${r.occurredAt},
          ${r.status}, 'SUCCESS', ${r.amountPaise}, 0, 0
        ) ON CONFLICT DO NOTHING
      `;
    }

    console.log('Inserted interleaved test rows.');

    // Now query ordered by occurred_at DESC
    const queried = await sql`
      SELECT txn_id, source, occurred_at FROM transactions
      WHERE tenant_id = ${tenant.id}
      ORDER BY occurred_at DESC
    `;
    console.log('QUERY RESULT ORDERED BY occurred_at DESC:');
    for (const q of queried) {
      console.log(`- [${q.source}] ${q.txn_id} @ ${q.occurred_at.toISOString()}`);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sql.end();
  }
}

testBothPortals();


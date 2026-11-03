import crypto from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { transactions } from '@/drizzle/schema';
import {
  encryptCustomerNo,
  hashCustomerNo,
} from '@/lib/crypto';
import { addMemoryTransactions } from '@/lib/memory-store';
import type { ApiTransaction } from '@walletsync/contract';

export async function seedDatabaseTransactions(
  tenantId: string,
  deviceId?: string,
): Promise<void> {
  const now = new Date();

  // 1. Check if transactions already exist in database for this tenant
  try {
    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(eq(transactions.tenantId, tenantId));

    if ((existing[0]?.count || 0) > 0) {
      return;
    }
  } catch {
    // Database check failed or offline; continue
  }

  const sampleRows = [
    {
      source: 'simplewallet' as const,
      service: 'Recharge',
      serviceName: 'Jio Prepaid Fast',
      customerNo: '5848291234',
      customerLast4: '4829',
      amountPaise: 29900,
      discountPct: '2.50',
      discountPaise: 747,
      status: 'success' as const,
      statusRaw: 'SUCCESS',
      operatorRef: 'BR' + Math.floor(10000000 + Math.random() * 90000000),
      occurredAt: new Date(now.getTime() - 2 * 60 * 1000),
    },
    {
      source: 'simplewallet' as const,
      service: 'Bill Pay',
      serviceName: 'Airtel Postpaid Bill',
      customerNo: '5888315678',
      customerLast4: '8831',
      amountPaise: 71900,
      discountPct: '2.00',
      discountPaise: 1438,
      status: 'success' as const,
      statusRaw: 'SUCCESS',
      operatorRef: 'AIR' + Math.floor(10000000 + Math.random() * 90000000),
      occurredAt: new Date(now.getTime() - 7 * 60 * 1000),
    },
    {
      source: 'egpayment' as const,
      service: 'DTH',
      serviceName: 'Tata Play HD Max',
      customerNo: '5819209999',
      customerLast4: '1920',
      amountPaise: 45000,
      discountPct: '3.00',
      discountPaise: 1350,
      status: 'success' as const,
      statusRaw: 'SUCCESS',
      operatorRef: 'TP' + Math.floor(10000000 + Math.random() * 90000000),
      occurredAt: new Date(now.getTime() - 14 * 60 * 1000),
    },
    {
      source: 'egpayment' as const,
      service: 'Recharge',
      serviceName: 'Vi Unlimited 84D',
      customerNo: '5877218888',
      customerLast4: '7721',
      amountPaise: 85900,
      discountPct: '2.20',
      discountPaise: 1889,
      status: 'pending' as const,
      statusRaw: 'PENDING',
      operatorRef: 'VI' + Math.floor(10000000 + Math.random() * 90000000),
      occurredAt: new Date(now.getTime() - 25 * 60 * 1000),
    },
  ];

  const memTxns: ApiTransaction[] = [];

  for (const s of sampleRows) {
    const prefix = s.source === 'simplewallet' ? 'SW' : 'EG';
    const txnId = `${prefix}${Math.floor(100000000 + Math.random() * 900000000)}`;

    try {
      await db.insert(transactions).values({
        tenantId,
        deviceId: deviceId || null,
        source: s.source,
        txnId,
        service: s.service,
        serviceName: s.serviceName,
        customerNo: encryptCustomerNo(s.customerNo, tenantId),
        customerLast4: s.customerLast4,
        customerNoHash: hashCustomerNo(s.customerNo),
        occurredAt: s.occurredAt,
        status: s.status,
        statusRaw: s.statusRaw,
        operatorRef: s.operatorRef,
        amountPaise: s.amountPaise,
        discountPct: s.discountPct,
        discountPaise: s.discountPaise,
        parserVersion: '1.0.0',
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // Ignore conflict or offline DB errors
    }

    memTxns.push({
      id: crypto.randomUUID(),
      tenantId,
      txnId,
      source: s.source,
      service: s.service,
      serviceName: s.serviceName,
      customerLast4: s.customerLast4,
      customerNoMasked: `••••••${s.customerLast4}`,
      occurredAt: s.occurredAt.toISOString(),
      status: s.status,
      statusRaw: s.statusRaw,
      operatorRef: s.operatorRef,
      amountPaise: s.amountPaise,
      discountPct: parseFloat(s.discountPct),
      discountPaise: s.discountPaise,
      parserVersion: '1.0.0',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  // Also seed memory store for zero-latency local fallback
  addMemoryTransactions(memTxns);
}

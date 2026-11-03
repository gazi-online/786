import crypto from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { withTenantContext, type AppTransaction } from '@/lib/db';
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

  // Use withTenantContext to ensure all PostgreSQL operations satisfy Row Level Security (RLS)
  try {
    await withTenantContext(tenantId, async (tx: AppTransaction) => {
      // 1. Check if transactions already exist in database for this tenant under RLS
      const existing = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(eq(transactions.tenantId, tenantId));

      if ((existing[0]?.count || 0) > 0) {
        return;
      }

      for (const s of sampleRows) {
        const prefix = s.source === 'simplewallet' ? 'SW' : 'EG';
        const txnId = `${prefix}${Math.floor(100000000 + Math.random() * 900000000)}`;

        await tx.insert(transactions).values({
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
    });
  } catch {
    // Database offline or transactional failure; generate memory transactions as zero-latency fallback
    for (const s of sampleRows) {
      const prefix = s.source === 'simplewallet' ? 'SW' : 'EG';
      const txnId = `${prefix}${Math.floor(100000000 + Math.random() * 900000000)}`;
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
  }

  // Also seed memory store for zero-latency local fallback
  if (memTxns.length > 0) {
    addMemoryTransactions(memTxns);
  }
}

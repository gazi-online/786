import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions, auditLog } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { decryptCustomerNo } from '@/lib/crypto';
import { getTenantSession, canPerformAction } from '@/lib/auth';
import { getMemoryTransactions } from '@/lib/memory-store';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getTenantSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
    }

    if (!canPerformAction(session.role, 'customer_no:reveal')) {
      return NextResponse.json(
        { error: 'Forbidden: Viewers are not permitted to reveal customer numbers' },
        { status: 403 },
      );
    }

    const { id } = await params;
    const hasDb = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);
    let txn: { id: string; tenantId: string; customerNo: string; txnId: string; service: string } | null = null;

    if (hasDb) {
      try {
        const rows = await db
          .select()
          .from(transactions)
          .where(and(eq(transactions.id, id), eq(transactions.tenantId, session.tenant.id)));

        if (rows.length > 0 && rows[0]) {
          txn = rows[0];
        }
      } catch {
        // Database query failed
      }
    } else {
      const memTxn = getMemoryTransactions().find((t) => t.id === id && t.tenantId === session.tenant.id);
      if (memTxn) {
        txn = {
          id: memTxn.id,
          tenantId: memTxn.tenantId,
          customerNo: '',
          txnId: memTxn.txnId,
          service: memTxn.service,
        };
      }
    }

    if (!txn) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Decrypt full customer mobile number (PII)
    let plaintextCustomerNo = '';
    try {
      plaintextCustomerNo = decryptCustomerNo(txn.customerNo, txn.tenantId);
    } catch {
      return NextResponse.json(
        { error: 'Failed to decrypt customer number' },
        { status: 500 },
      );
    }

    // Write audit log entry (GUIDE.md §5 & §7)
    if (hasDb) {
      try {
        await db.insert(auditLog).values({
          tenantId: txn.tenantId,
          action: 'reveal_customer_no',
          targetType: 'transaction',
          targetId: txn.id,
          meta: {
            txnId: txn.txnId,
            service: txn.service,
            clientIp: req.headers.get('x-forwarded-for') || 'unknown',
          },
        });
      } catch {
        // Audit log insert error handled
      }
    }

    return NextResponse.json({
      id: txn.id,
      customerNo: plaintextCustomerNo,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions, auditLog } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { decryptCustomerNo } from '@/lib/crypto';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));

    const txn = rows[0];
    if (!txn) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Decrypt full customer mobile number (PII)
    let plaintextCustomerNo = '';
    try {
      plaintextCustomerNo = decryptCustomerNo(txn.customerNo);
    } catch {
      return NextResponse.json(
        { error: 'Failed to decrypt customer number' },
        { status: 500 },
      );
    }

    // Write audit log entry (GUIDE.md §5 & §7)
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

    return NextResponse.json({
      id: txn.id,
      customerNo: plaintextCustomerNo,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

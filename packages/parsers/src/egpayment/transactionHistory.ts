/**
 * egpayment.com transaction history parser.
 *
 * Runs inside the Chrome extension content script.
 * Strictly read-only, pure function, no side effects.
 *
 * Layout verified from live egpayment.com HTML fixture:
 * - Sentinel: "TRANSACTIONS HISTORY"
 * - Transaction cards: <a href=".../transaction_receipt/:txnId">
 *   - Order ID: <h4 class="left">Order ID: :id</h4>
 *   - Amount: <h3 class="right">₹:amount</h3>
 *   - Operator: .walletHistoryData .left h3
 *   - Customer Number: .walletHistoryData .left span
 *   - Status: button.btn (SUCCESS, PENDING, FAILED, REFUNDED)
 *   - Operator Ref: <h4>Operator Ref : :ref</h4>
 *   - Occurred Date: <h4 class="right">MM/dd/yyyy, hh:mm a</h4> (Asia/Kolkata)
 *   - Commission: <h4>Comm: ₹:comm</h4>
 */

import type { IngestTransaction, ParseResult, TransactionStatus } from '@walletsync/contract';

export const PARSER_VERSION = '1.0.0';
export const LOGGED_IN_SENTINEL = 'TRANSACTIONS HISTORY';

function parseDate(rawDate: string): string | null {
  // Format: "10/29/2026, 02:00 PM"
  const clean = rawDate.trim();
  const match = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6]) {
    return null;
  }
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  let hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const meridiem = match[6].toUpperCase();

  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+05:30`;
}

function mapStatus(raw: string): TransactionStatus {
  const upper = (raw || '').toUpperCase().trim();
  if (!upper) return 'unknown';

  if (upper.includes('SUCCESS') || upper === 'DONE' || upper === 'COMPLETED' || upper === 'OK') {
    return 'success';
  }
  if (
    upper.includes('FAIL') ||
    upper.includes('DECLIN') ||
    upper.includes('REJECT') ||
    upper.includes('CANCEL') ||
    upper.includes('ERROR') ||
    upper.includes('INVALID') ||
    upper.includes('DISPUTE')
  ) {
    return 'failed';
  }
  if (upper.includes('REFUND') || upper.includes('REVERS') || upper.includes('CREDIT BACK')) {
    return 'refunded';
  }
  if (
    upper.includes('PEND') ||
    upper.includes('PROCESS') ||
    upper.includes('QUEUE') ||
    upper.includes('WAIT') ||
    upper.includes('SUBMIT') ||
    upper.includes('HOLD')
  ) {
    return 'pending';
  }
  return 'unknown';
}

function classifyService(serviceName: string): string {
  const sLower = serviceName.toLowerCase();
  if (sLower.includes('dth') || sLower.includes('play') || sLower.includes('tv') || sLower.includes('sun direct')) {
    return 'DTH';
  }
  if (sLower.includes('google') || sLower.includes('card') || sLower.includes('voucher')) {
    return 'Gift Card';
  }
  if (sLower.includes('elect') || sLower.includes('bill') || sLower.includes('gas') || sLower.includes('water')) {
    return 'Bill Payment';
  }
  return 'Prepaid';
}

export function parseEgPayment(html: string): ParseResult {
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');

  const doc = new DOMParser().parseFromString(cleanHtml, 'text/html');

  // 1. Logged in check
  const bodyText = doc.body?.textContent?.toUpperCase() ?? '';
  if (!bodyText.includes(LOGGED_IN_SENTINEL)) {
    return {
      ok: false,
      source: 'egpayment',
      reason: 'logged_out',
      detail: `Sentinel text "${LOGGED_IN_SENTINEL}" not found.`,
    };
  }

  // 2. Find transaction cards
  const cardAnchors = Array.from(doc.querySelectorAll('a[href*="/transaction_receipt/"]'));
  if (cardAnchors.length === 0) {
    return {
      ok: false,
      source: 'egpayment',
      reason: 'layout_changed',
      detail: 'No transaction cards matching a[href*="/transaction_receipt/"] found.',
    };
  }

  const rows: IngestTransaction[] = [];
  let totalPaise = 0;

  for (const anchor of cardAnchors) {
    const href = anchor.getAttribute('href') || '';
    const orderIdMatch = anchor.textContent?.match(/Order ID:\s*([0-9a-zA-Z]+)/i);
    const hrefMatch = href.match(/\/transaction_receipt\/([0-9a-zA-Z]+)/);

    // Fail closed if both IDs exist but differ (prevent silent picking)
    if (orderIdMatch && hrefMatch && orderIdMatch[1] !== hrefMatch[1]) {
      return {
        ok: false,
        source: 'egpayment',
        reason: 'layout_changed',
        detail: `ID mismatch on card: Order ID "${orderIdMatch[1]}" does not match receipt link ID "${hrefMatch[1]}".`,
      };
    }

    const txnId = orderIdMatch?.[1] || hrefMatch?.[1];
    if (!txnId) continue;

    // Amount in h3 with ₹
    const amtEl = anchor.querySelector('.walletHistoryFooter h3, h3.right');
    const amtMatch = (amtEl?.textContent || anchor.textContent || '').match(/₹\s*([0-9,.]+)/);
    const amountRupees = amtMatch && amtMatch[1] ? parseFloat(amtMatch[1].replace(/,/g, '')) : 0;
    const amountPaise = Math.round(amountRupees * 100);

    // Operator and Customer Number
    const dataLeft = anchor.querySelector('.walletHistoryData .left');
    const serviceName = dataLeft?.querySelector('h3')?.textContent?.trim() || 'Unknown';
    const customerNo = dataLeft?.querySelector('span')?.textContent?.replace(/\s+/g, '') || '';

    // Status
    const statusBtn = anchor.querySelector('button.btn');
    const statusRaw = statusBtn?.textContent?.trim() || 'SUCCESS';
    const status = mapStatus(statusRaw);

    // Operator Ref
    const opRefEl = Array.from(anchor.querySelectorAll('h4')).find((el) =>
      el.textContent?.includes('Operator Ref'),
    );
    const operatorRef = opRefEl?.textContent?.replace(/.*?Operator Ref\s*:\s*/i, '').trim() || '';

    // Occurred Date
    const dateEl = anchor.querySelector('.walletHistoryFooter h4.right');
    const rawDate = dateEl?.textContent?.trim() || '';
    const occurredAt = parseDate(rawDate) || new Date().toISOString();

    // Commission (Discount)
    const commMatch = anchor.textContent?.match(/Comm:\s*₹?\s*([0-9,.]+)/i);
    const commRupees = commMatch && commMatch[1] ? parseFloat(commMatch[1].replace(/,/g, '')) : 0;
    const discountPaise = Math.round(commRupees * 100);
    const discountPct = amountPaise > 0 ? (discountPaise / amountPaise) * 100 : 0;

    const service = classifyService(serviceName);

    rows.push({
      txnId,
      source: 'egpayment',
      service,
      serviceName,
      customerNo,
      occurredAt,
      status,
      statusRaw,
      operatorRef,
      amountPaise,
      discountPct: Math.round(discountPct * 100) / 100,
      discountPaise,
    });

    totalPaise += amountPaise;
  }

  // Balance extraction if present
  const balanceEl = doc.getElementById('walletBalance');
  let balancePaise: number | null = null;
  if (balanceEl && balanceEl.textContent) {
    const bMatch = balanceEl.textContent.match(/([0-9,.]+)/);
    if (bMatch && bMatch[1]) balancePaise = Math.round(parseFloat(bMatch[1].replace(/,/g, '')) * 100);
  }

  return {
    ok: true,
    source: 'egpayment',
    parserVersion: PARSER_VERSION,
    capturedAt: new Date().toISOString(),
    balancePaise,
    pageTotals: {
      amountPaise: totalPaise,
    },
    rows,
  };
}

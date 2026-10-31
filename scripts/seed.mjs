import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const happyDomUrl = pathToFileURL(path.join(rootDir, 'packages/parsers/node_modules/happy-dom/lib/index.js')).href;
const { Window } = await import(happyDomUrl);
const window = new Window();
globalThis.DOMParser = window.DOMParser;

const parsersUrl = pathToFileURL(path.join(rootDir, 'packages/parsers/dist/index.js')).href;
const { parse } = await import(parsersUrl);

async function run() {
  console.log('--- Seeding Demo Fixtures into WalletSync ---');

  // SimpleWallet
  const swHtml = fs.readFileSync(path.join(rootDir, 'fixtures/simplewallet/normal-day.html'), 'utf-8');
  const swRes = parse(swHtml, 'simplewallet');
  if (!swRes.ok) {
    console.error('SimpleWallet parse failed:', swRes);
    return;
  }
  console.log(`Parsed SimpleWallet: ${swRes.rows.length} rows`);

  const swPayload = {
    schemaVersion: 1,
    deviceId: '00000000-0000-0000-0000-000000000002',
    parserVersion: '1.0.0',
    capturedAt: new Date().toISOString(),
    balancePaise: swRes.balancePaise ?? 19798,
    pageTotals: swRes.pageTotals ?? { amountPaise: 144800 },
    rows: swRes.rows.map((t) => ({
      source: 'simplewallet',
      txnId: t.txnId,
      service: t.service,
      serviceName: t.serviceName,
      customerNo: t.customerNo,
      occurredAt: t.occurredAt,
      status: t.status,
      statusRaw: t.statusRaw,
      operatorRef: t.operatorRef,
      amountPaise: t.amountPaise,
      discountPct: t.discountPct,
      discountPaise: t.discountPaise,
    })),
  };

  const swResPost = await fetch('http://localhost:3000/api/v1/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_device_token',
    },
    body: JSON.stringify(swPayload),
  });
  console.log('SimpleWallet Ingest Status:', swResPost.status, await swResPost.json());

  // EG Payment
  const egHtml = fs.readFileSync(path.join(rootDir, 'fixtures/egpayment/normal-day.html'), 'utf-8');
  const egRes = parse(egHtml, 'egpayment');
  if (!egRes.ok) {
    console.error('EG Payment parse failed:', egRes);
    return;
  }
  console.log(`Parsed EG Payment: ${egRes.rows.length} rows`);

  const egPayload = {
    schemaVersion: 1,
    deviceId: '00000000-0000-0000-0000-000000000002',
    parserVersion: '1.0.0',
    capturedAt: new Date().toISOString(),
    balancePaise: egRes.balancePaise ?? null,
    pageTotals: egRes.pageTotals ?? { amountPaise: 1364700 },
    rows: egRes.rows.map((t) => ({
      source: 'egpayment',
      txnId: t.txnId,
      service: t.service,
      serviceName: t.serviceName,
      customerNo: t.customerNo,
      occurredAt: t.occurredAt,
      status: t.status,
      statusRaw: t.statusRaw,
      operatorRef: t.operatorRef,
      amountPaise: t.amountPaise,
      discountPct: t.discountPct,
      discountPaise: t.discountPaise,
    })),
  };

  const egResPost = await fetch('http://localhost:3000/api/v1/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_device_token',
    },
    body: JSON.stringify(egPayload),
  });
  console.log('EG Payment Ingest Status:', egResPost.status, await egResPost.json());
}

run().catch(console.error);

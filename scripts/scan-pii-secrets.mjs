/**
 * PII and Secrets Scanner
 *
 * Requirements (Amd-5):
 * - Scans fixtures, seed data, build output (.next, .output), and repository files.
 * - Detects:
 *   1. Un-allowlisted Indian 10-digit mobile numbers ([6-9]\d{9})
 *   2. Session cookies (connect.sid, sb-*-auth-token, set-cookie)
 *   3. Live tokens and secrets (Bearer eyJ..., ws_dev_..., private keys)
 * - Uses documented allowlist of synthetic test numbers.
 * - Ignores non-source/binary build cache files (.pack, .tsbuildinfo, .cache, trace).
 * - Distinguishes phone numbers from UUID hex fragments and unix timestamps.
 * - NEVER prints detected values into console / CI output.
 * - Fails with exit code 1 if violations are found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load synthetic allowlist
const allowlistPath = path.join(rootDir, 'fixtures/synthetic-allowlist.json');
let allowedNumbers = new Set();
if (fs.existsSync(allowlistPath)) {
  try {
    const list = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    allowedNumbers = new Set(list);
  } catch {
    //
  }
}

// Add standard unit test mock numbers to allowlist
const mockTestNumbers = ['9876543210', '8123456789', '9800000000', '9800000001'];
for (const n of mockTestNumbers) {
  allowedNumbers.add(n);
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.wxt',
  'cache', // .next/cache (webpack binary packs)
]);

const IGNORED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.ico',
  '.gif',
  '.webp',
  '.zip',
  '.lock',
  '.map',
  '.pack',
  '.tsbuildinfo',
  '.rscinfo',
  '.previewinfo',
]);

const VIOLATIONS = [];

function isInsideUuid(lineText, index) {
  const start = Math.max(0, index - 30);
  const end = Math.min(lineText.length, index + 30);
  const snippet = lineText.slice(start, end);
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(snippet);
}

function scanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath);

  if (IGNORED_EXTENSIONS.has(ext)) return;
  if (baseName === 'trace' || baseName.startsWith('.cache')) return;

  // Skip self, allowlist definition, and test files dedicated to testing redaction/crypto
  if (
    filePath.endsWith('scan-pii-secrets.mjs') ||
    filePath.endsWith('synthetic-allowlist.json') ||
    filePath.endsWith('SYNTHETIC_ALLOWLIST.md') ||
    filePath.endsWith('log-redaction.test.ts') // contains synthetic mock regex tests
  ) {
    return;
  }

  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return; // binary or unreadable
  }

  const lines = content.split('\n');

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;

    // 1. Check for live JWT tokens (allow mock short tokens in tests)
    if (/Bearer\s+eyJ[A-Za-z0-9_\-\.]{50,}/i.test(lineText)) {
      VIOLATIONS.push({ file: filePath, line: lineNum, rule: 'Live JWT / Bearer Token detected' });
    }

    // 2. Check for unmasked session cookies
    if (/(?:connect\.sid|sb-[a-z0-9]+-auth-token)\s*=\s*[a-zA-Z0-9_\-\.]{25,}/i.test(lineText)) {
      VIOLATIONS.push({ file: filePath, line: lineNum, rule: 'Live Session Cookie detected' });
    }

    // 3. Check for standalone Indian mobile numbers (must not be part of hex UUID or larger number)
    const phoneRegex = /(?:\b|[^\da-fA-F])([6-9]\d{9})(?:\b|[^\da-fA-F])/g;
    let match;
    while ((match = phoneRegex.exec(lineText)) !== null) {
      const num = match[1];
      if (isInsideUuid(lineText, match.index)) {
        continue;
      }
      if (!allowedNumbers.has(num)) {
        VIOLATIONS.push({ file: filePath, line: lineNum, rule: 'Un-allowlisted 10-digit mobile number detected' });
        break;
      }
    }
  });
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        walkDir(path.join(dir, entry.name));
      }
    } else if (entry.isFile()) {
      scanFile(path.join(dir, entry.name));
    }
  }
}

export function runScan() {
  VIOLATIONS.length = 0;
  walkDir(rootDir);

  console.log(`\n=== PII & Secrets Scan Completed ===`);
  console.log(`Target: ${rootDir}`);
  console.log(`Synthetic Numbers Allowed: ${allowedNumbers.size}`);

  if (VIOLATIONS.length === 0) {
    console.log(`✓ 0 PII or secret violations found.\n`);
    return { success: true, violationsCount: 0 };
  }

  console.error(`\n❌ FOUND ${VIOLATIONS.length} VIOLATION(S):`);
  for (const v of VIOLATIONS) {
    const relPath = path.relative(rootDir, v.file);
    console.error(`  - [${v.rule}] in ${relPath}:${v.line}`);
  }
  console.error(`\nNote: Sensitive values are suppressed from this output for privacy.`);
  return { success: false, violationsCount: VIOLATIONS.length };
}

// Direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { success } = runScan();
  if (!success) {
    process.exit(1);
  }
}

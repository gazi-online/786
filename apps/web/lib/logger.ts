/**
 * Secure Allowlist-Based Logging and PII Redaction Utility.
 *
 * Requirements (Amd-4):
 * - Logging is allowlist-based: NEVER log request bodies, auth headers, cookies, or SQL parameters.
 * - Regex redaction as a defensive backstop.
 * - Covers error paths, unhandled exceptions, and request logs.
 */

// Defensive redaction patterns as backstop
const REDACTION_PATTERNS = [
  // Bearer / Device tokens
  { regex: /Bearer\s+([A-Za-z0-9_\-.]{10,})/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { regex: /ws_dev_[0-9a-f]{32,}/gi, replacement: '[REDACTED_DEVICE_TOKEN]' },
  { regex: /[0-9a-f]{64}/gi, replacement: '[REDACTED_64HEX]' },
  // 10-digit mobile or synthetic customer numbers: starts with 5, 6, 7, 8, or 9
  { regex: /(?:\b|[^\d])([5-9]\d{9})(?:\b|[^\d])/g, replacement: (match: string, p1: string) => match.replace(p1, '[REDACTED_PHONE]') },
  // Cookie headers: redact entire cookie string following cookie: or set-cookie:
  { regex: /(?:cookie|set-cookie):\s*[^\r\n]+/gi, replacement: 'cookie: [REDACTED_COOKIE]' },
  // Password or secret fields in JSON / query
  { regex: /"(?:password|secret|key|token|customerNo)":\s*"[^"]+"/gi, replacement: '"[REDACTED_FIELD]": "[REDACTED]"' },
];

export function redactSensitiveText(input: string): string {
  let output = input;
  for (const item of REDACTION_PATTERNS) {
    if (typeof item.replacement === 'function') {
      output = output.replace(item.regex, item.replacement as (substring: string, ...args: string[]) => string);
    } else {
      output = output.replace(item.regex, item.replacement);
    }
  }
  return output;
}

export interface SafeLogMeta {
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  tenantId?: string;
  errorName?: string;
}

/**
 * Allowlist logger: only safe metadata fields are formatted and logged.
 * Never includes raw request body, query parameters with PII, or raw error messages containing PII.
 */
export function formatSafeLog(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: SafeLogMeta): string {
  const parts = [`[${level}] ${redactSensitiveText(message)}`];

  if (meta) {
    const metaParts: string[] = [];
    if (meta.route) metaParts.push(`route=${meta.route}`);
    if (meta.method) metaParts.push(`method=${meta.method}`);
    if (meta.status) metaParts.push(`status=${meta.status}`);
    if (meta.durationMs !== undefined) metaParts.push(`duration=${meta.durationMs}ms`);
    if (meta.tenantId) metaParts.push(`tenant=${meta.tenantId}`);
    if (meta.errorName) metaParts.push(`error=${meta.errorName}`);
    if (metaParts.length > 0) {
      parts.push(`(${metaParts.join(', ')})`);
    }
  }

  return parts.join(' ');
}

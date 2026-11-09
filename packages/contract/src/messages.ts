import { z } from 'zod';
import { ParseResultSchema } from './parse-result';
import { ClaimedRechargeOrderSchema } from './recharge';

/**
 * Checks whether a given URL is an allowed portal history URL for content script messages.
 * Only simplewallet.in /web/mytrans.aspx* and egpayment.com /users/recharge_history* are permitted.
 */
export function isAllowedPortalHistoryUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    // simplewallet.in: origin simplewallet.in or www.simplewallet.in, path starts with /web/mytrans.aspx or /web/mobilerecharge.aspx
    if (
      (hostname === 'simplewallet.in' || hostname === 'www.simplewallet.in') &&
      (pathname.startsWith('/web/mytrans.aspx') || pathname.startsWith('/web/mobilerecharge.aspx'))
    ) {
      return true;
    }

    // egpayment.com: origin egpayment.com or www.egpayment.com, path starts with /users/recharge_history
    if (
      (hostname === 'egpayment.com' || hostname === 'www.egpayment.com') &&
      pathname.startsWith('/users/recharge_history')
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Checks whether a given URL is an allowed portal recharge form URL.
 * Only simplewallet.in /web/mobilerecharge.aspx* and egpayment.com /users/recharge* are permitted.
 */
export function isAllowedPortalRechargeUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    // simplewallet.in: origin simplewallet.in or www.simplewallet.in, path starts with /web/mobilerecharge.aspx
    if (
      (hostname === 'simplewallet.in' || hostname === 'www.simplewallet.in') &&
      pathname.startsWith('/web/mobilerecharge.aspx')
    ) {
      return true;
    }

    // egpayment.com: origin egpayment.com or www.egpayment.com, path is /users/recharge or /users/recharge/*
    // (Must strictly exclude /users/recharge_history which is the transaction history page)
    if (
      (hostname === 'egpayment.com' || hostname === 'www.egpayment.com') &&
      (pathname === '/users/recharge' || pathname.startsWith('/users/recharge/')) &&
      !pathname.startsWith('/users/recharge_history')
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function isAllowedWebAppUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === 'walletsync-seven.vercel.app' ||
      hostname.endsWith('.vercel.app') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

function isValidHttpUrl(str?: string | null): boolean {
  if (!str) return true;
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Background Message Schemas (Inbound to background.ts)
// ---------------------------------------------------------------------------

export const ContentParsedPageMessageSchema = z.object({
  type: z.literal('CONTENT_PARSED_PAGE'),
  result: ParseResultSchema,
});
export type ContentParsedPageMessage = z.infer<typeof ContentParsedPageMessageSchema>;

export const ContentParserErrorMessageSchema = z.object({
  type: z.literal('CONTENT_PARSER_ERROR'),
  error: z.object({
    reason: z.string().min(1).max(100),
    detail: z.string().max(1000).optional(),
  }),
});
export type ContentParserErrorMessage = z.infer<typeof ContentParserErrorMessageSchema>;

export const PairDeviceMessageSchema = z.object({
  type: z.literal('PAIR_DEVICE'),
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .refine(
      (val) => {
        const clean = val.replace(/[^A-Za-z0-9]/g, '');
        return clean.length === 8;
      },
      { message: 'Pairing code must contain exactly 8 alphanumeric characters' },
    ),
  apiUrl: z
    .string()
    .max(2048)
    .optional()
    .refine((url) => !url || isValidHttpUrl(url), {
      message: 'apiUrl must be a valid http(s) URL',
    }),
});
export type PairDeviceMessage = z.infer<typeof PairDeviceMessageSchema>;

export const UnpairDeviceMessageSchema = z.object({
  type: z.literal('UNPAIR_DEVICE'),
});
export type UnpairDeviceMessage = z.infer<typeof UnpairDeviceMessageSchema>;

export const SyncNowMessageSchema = z.object({
  type: z.literal('SYNC_NOW'),
});
export type SyncNowMessage = z.infer<typeof SyncNowMessageSchema>;

export const TogglePauseMessageSchema = z.object({
  type: z.literal('TOGGLE_PAUSE'),
});
export type TogglePauseMessage = z.infer<typeof TogglePauseMessageSchema>;

export const PortalRechargeResultMessageSchema = z.object({
  type: z.literal('PORTAL_RECHARGE_RESULT'),
  orderId: z.string().uuid(),
  status: z.enum(['submitting', 'submitted', 'failed', 'needs_manual_action']),
  failureCode: z.string().trim().max(64).optional(),
  failureDetail: z
    .string()
    .trim()
    .max(500)
    .refine(
      (val) => !val || !/(?:\b|[^\da-fA-F])([5-9]\d{9})(?:\b|[^\da-fA-F])/.test(val),
      { message: 'failureDetail must never contain phone numbers' },
    )
    .optional(),
  qrDataUrl: z.string().max(100000).optional(),
  qrAmount: z.string().max(64).optional(),
  qrTimer: z.string().max(64).optional(),
});
export type PortalRechargeResultMessage = z.infer<typeof PortalRechargeResultMessageSchema>;

export const DispatchRechargeNowMessageSchema = z.object({
  type: z.literal('DISPATCH_RECHARGE_NOW'),
});
export type DispatchRechargeNowMessage = z.infer<typeof DispatchRechargeNowMessageSchema>;

export const LookupOperatorOnPortalMessageSchema = z.object({
  type: z.literal('LOOKUP_OPERATOR_ON_PORTAL'),
  mobile: z.string().regex(/^[5-9]\d{9}$/),
  portal: z.string().optional(),
});
export type LookupOperatorOnPortalMessage = z.infer<typeof LookupOperatorOnPortalMessageSchema>;

export const BackgroundMessageSchema = z.discriminatedUnion('type', [
  ContentParsedPageMessageSchema,
  ContentParserErrorMessageSchema,
  PairDeviceMessageSchema,
  UnpairDeviceMessageSchema,
  SyncNowMessageSchema,
  TogglePauseMessageSchema,
  PortalRechargeResultMessageSchema,
  DispatchRechargeNowMessageSchema,
  LookupOperatorOnPortalMessageSchema,
]);
export type BackgroundMessage = z.infer<typeof BackgroundMessageSchema>;

// ---------------------------------------------------------------------------
// Content Script Message Schemas (Inbound to content.ts / recharge.content.ts)
// ---------------------------------------------------------------------------

export const TriggerParseMessageSchema = z.object({
  type: z.literal('TRIGGER_PARSE'),
  refresh: z.boolean().optional(),
});
export type TriggerParseMessage = z.infer<typeof TriggerParseMessageSchema>;

export const TriggerShowClickMessageSchema = z.object({
  type: z.literal('TRIGGER_SHOW_CLICK'),
  refresh: z.boolean().optional(),
});
export type TriggerShowClickMessage = z.infer<typeof TriggerShowClickMessageSchema>;

export const ExecutePortalRechargeMessageSchema = z.object({
  type: z.literal('EXECUTE_PORTAL_RECHARGE'),
  order: ClaimedRechargeOrderSchema,
});
export type ExecutePortalRechargeMessage = z.infer<typeof ExecutePortalRechargeMessageSchema>;

export const ContentScriptMessageSchema = z.discriminatedUnion('type', [
  TriggerParseMessageSchema,
  TriggerShowClickMessageSchema,
  ExecutePortalRechargeMessageSchema,
]);
export type ContentScriptMessage = z.infer<typeof ContentScriptMessageSchema>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface MessageSenderLike {
  id?: string;
  tab?: {
    id?: number;
    url?: string;
  };
}

export type BackgroundValidationResult =
  | { ok: true; message: BackgroundMessage; source: 'content' | 'ui' }
  | { ok: false; reason: string };

/**
 * Validates inbound messages to background.ts:
 * 1. sender.id === runtimeId
 * 2. CONTENT_PARSED_PAGE & CONTENT_PARSER_ERROR require sender.tab and matching portal URL
 * 3. PAIR_DEVICE, UNPAIR_DEVICE, SYNC_NOW, TOGGLE_PAUSE reject if sender.tab is present
 * 4. Payloads validated via Zod schemas
 */
export function validateBackgroundMessage(
  rawMessage: unknown,
  sender: MessageSenderLike | undefined,
  expectedRuntimeId: string,
): BackgroundValidationResult {
  // Reject any message where sender.id !== chrome.runtime.id
  if (!sender?.id || sender.id !== expectedRuntimeId) {
    return { ok: false, reason: 'unauthorized_sender_id' };
  }

  // Validate payload against allowed background messages
  const parseResult = BackgroundMessageSchema.safeParse(rawMessage);
  if (!parseResult.success) {
    return { ok: false, reason: 'malformed_payload' };
  }

  const msg = parseResult.data;

  // Enforce origin restrictions
  if (msg.type === 'CONTENT_PARSED_PAGE' || msg.type === 'CONTENT_PARSER_ERROR') {
    if (!sender.tab || !sender.tab.url) {
      return { ok: false, reason: 'missing_tab_url' };
    }
    if (!isAllowedPortalHistoryUrl(sender.tab.url)) {
      return { ok: false, reason: 'unauthorized_tab_url' };
    }
    return { ok: true, message: msg, source: 'content' };
  }

  // Content script messages from recharge runner
  if (msg.type === 'PORTAL_RECHARGE_RESULT') {
    if (!sender.tab || !sender.tab.url) {
      return { ok: false, reason: 'missing_tab_url' };
    }
    if (!isAllowedPortalRechargeUrl(sender.tab.url)) {
      return { ok: false, reason: 'unauthorized_tab_url' };
    }
    return { ok: true, message: msg, source: 'content' };
  }

  // Web app bridge messages for live telecom query
  if (msg.type === 'LOOKUP_OPERATOR_ON_PORTAL') {
    if (!sender.tab || !sender.tab.url) {
      return { ok: false, reason: 'missing_tab_url' };
    }
    if (!isAllowedWebAppUrl(sender.tab.url)) {
      return { ok: false, reason: 'unauthorized_web_app_url' };
    }
    return { ok: true, message: msg, source: 'content' };
  }

  // UI messages (PAIR_DEVICE, UNPAIR_DEVICE, SYNC_NOW, TOGGLE_PAUSE)
  // Must be rejected if they come from a content script (sender.tab is set)
  if (sender.tab !== undefined && sender.tab !== null) {
    return { ok: false, reason: 'tab_sender_disallowed_for_ui_action' };
  }

  return { ok: true, message: msg, source: 'ui' };
}

export type ContentValidationResult =
  | { ok: true; message: ContentScriptMessage }
  | { ok: false; reason: string };

/**
 * Validates inbound messages to content.ts:
 * 1. sender.id === runtimeId
 * 2. TRIGGER_PARSE / TRIGGER_SHOW_CLICK schema validation
 */
export function validateContentMessage(
  rawMessage: unknown,
  sender: MessageSenderLike | undefined,
  expectedRuntimeId: string,
): ContentValidationResult {
  if (!sender?.id || sender.id !== expectedRuntimeId) {
    return { ok: false, reason: 'unauthorized_sender_id' };
  }

  const parseResult = ContentScriptMessageSchema.safeParse(rawMessage);
  if (!parseResult.success) {
    return { ok: false, reason: 'malformed_payload' };
  }

  return { ok: true, message: parseResult.data };
}


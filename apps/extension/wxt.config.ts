import { defineConfig } from 'wxt';

// Determine environment
const isDev = process.env.NODE_ENV !== 'production';

// Build-time API origin configuration (read from WALLETSYNC_API_ORIGIN)
const rawApiOrigin =
  process.env.WALLETSYNC_API_ORIGIN ||
  (isDev ? 'http://localhost:3000/*' : 'https://api.walletsync.example.com/*');
const apiOrigin = rawApiOrigin.endsWith('/*') ? rawApiOrigin : `${rawApiOrigin.replace(/\/+$/, '')}/*`;

// HARD RULE (Amd-6 & Round 10):
// - Exactly the two portal origins plus ONE API origin read from build-time config
// - No wildcard subdomains (*.simplewallet.in or *.egpayment.com)
// - No http for portals
// - No localhost in production build
const hostPermissions: string[] = [
  'https://simplewallet.in/*',
  'https://egpayment.com/*',
  apiOrigin,
];

export default defineConfig({
  manifest: {
    name: 'WalletSync',
    description: 'Read-only sync of your recharge-portal transaction history.',
    version: '0.1.0',
    // Least permissions: host_permissions lists ONLY the two portal origins and ONE API origin
    // HARD RULE: no <all_urls>, no cookies, no webRequest, no history permission
    host_permissions: hostPermissions,
    permissions: ['storage', 'alarms', 'notifications', 'tabs'],
  },
});

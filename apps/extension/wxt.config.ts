import { defineConfig } from 'wxt';

// Determine environment
const isDev = process.env.NODE_ENV !== 'production';
const apiOrigin = process.env.WALLETSYNC_API_ORIGIN || (isDev ? 'http://localhost:3000/*' : '');

// Exactly the two portal origins, plus API origin if configured
// HARD RULE (Amd-6):
// - Exactly https://simplewallet.in/* and https://egpayment.com/*
// - No wildcard subdomains (*.simplewallet.in or *.egpayment.com)
// - No http (https only for portals)
// - No localhost in production build (dev flavor only)
const hostPermissions: string[] = [
  'https://simplewallet.in/*',
  'https://egpayment.com/*',
];

if (isDev) {
  hostPermissions.push('http://localhost/*');
  hostPermissions.push('http://127.0.0.1/*');
} else if (apiOrigin) {
  hostPermissions.push(apiOrigin);
}

export default defineConfig({
  manifest: {
    name: 'WalletSync',
    description: 'Read-only sync of your recharge-portal transaction history.',
    version: '0.1.0',
    // Least permissions: host_permissions lists ONLY the portal origin and API origin
    // HARD RULE: no <all_urls>, no cookies, no webRequest, no history permission
    host_permissions: hostPermissions,
    permissions: ['storage', 'alarms', 'notifications', 'tabs'],
  },
});

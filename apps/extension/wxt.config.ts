import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'WalletSync',
    description: 'Read-only sync of your recharge-portal transaction history.',
    version: '0.1.0',
    // Least permissions: host_permissions lists ONLY the portal origin and API origin
    // HARD RULE: no <all_urls>, no cookies, no webRequest, no history permission
    host_permissions: ['*://*.simplewallet.in/*', '*://*.egpayment.com/*', '*://localhost/*'],
    permissions: ['storage', 'alarms', 'notifications', 'tabs'],
  },
});


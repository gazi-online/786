import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Step 6 Hardening: Chrome Extension Manifest Audit (Amd-6)', () => {
  const manifestPath = path.resolve(__dirname, '../../extension/.output/chrome-mv3/manifest.json');

  it('ensures built manifest exists', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it('strictly forbids cookies, webRequest, history, and <all_urls> permissions', () => {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    const permissions: string[] = manifest.permissions || [];
    const hostPermissions: string[] = manifest.host_permissions || [];

    // HARD RULE: no cookies, no webRequest, no history
    expect(permissions).not.toContain('cookies');
    expect(permissions).not.toContain('webRequest');
    expect(permissions).not.toContain('history');
    expect(permissions).not.toContain('<all_urls>');

    expect(hostPermissions).not.toContain('<all_urls>');
    expect(hostPermissions).not.toContain('*://*/*');
  });

  it('restricts host_permissions strictly to https simplewallet and egpayment origins in production', () => {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const hostPermissions: string[] = manifest.host_permissions || [];

    // Verify exact origins
    expect(hostPermissions).toContain('https://simplewallet.in/*');
    expect(hostPermissions).toContain('https://egpayment.com/*');

    // No wildcard subdomains (*.simplewallet.in or *.egpayment.com)
    for (const hp of hostPermissions) {
      expect(hp).not.toContain('*.simplewallet.in');
      expect(hp).not.toContain('*.egpayment.com');
      // No http (https only for portals)
      if (hp.includes('simplewallet.in') || hp.includes('egpayment.com')) {
        expect(hp.startsWith('https://')).toBe(true);
      }
      // No localhost in production build
      expect(hp).not.toContain('localhost');
      expect(hp).not.toContain('127.0.0.1');
    }
  });

  it('scopes content_scripts strictly to exact recharge transaction history paths', () => {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    const contentScripts = manifest.content_scripts || [];
    expect(contentScripts.length).toBeGreaterThan(0);

    for (const cs of contentScripts) {
      const matches: string[] = cs.matches || [];
      for (const m of matches) {
        // Must match only exact history paths
        const isSwHistory = m.startsWith('https://simplewallet.in/web/MyTrans.aspx');
        const isEgHistory = m.startsWith('https://egpayment.com/users/recharge_history');
        expect(isSwHistory || isEgHistory).toBe(true);
      }
    }
  });
});

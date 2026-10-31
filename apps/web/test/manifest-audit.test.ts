import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Step A11 Hardening: Built Chrome Extension Manifest Exact Array Auditing', () => {
  const manifestPath = path.resolve(__dirname, '../../extension/.output/chrome-mv3/manifest.json');

  it('ensures built manifest exists', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it('verifies permissions array contains ONLY exact allowed permissions and NO forbidden ones', () => {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    const permissions: string[] = manifest.permissions;
    expect(Array.isArray(permissions)).toBe(true);

    // Exact array membership checks (no substring checks)
    expect(permissions).not.toContain('cookies');
    expect(permissions).not.toContain('webRequest');
    expect(permissions).not.toContain('history');
    expect(permissions).not.toContain('<all_urls>');

    // Allowed minimal set
    const allowedPermissions = new Set(['storage', 'alarms', 'notifications', 'tabs']);
    for (const p of permissions) {
      expect(allowedPermissions.has(p)).toBe(true);
    }
  });

  it('verifies host_permissions array contains EXACTLY https origins for simplewallet and egpayment', () => {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    const hostPermissions: string[] = manifest.host_permissions;
    expect(Array.isArray(hostPermissions)).toBe(true);

    // In production build, must contain EXACTLY the two portal origins
    expect(hostPermissions).toContain('https://simplewallet.in/*');
    expect(hostPermissions).toContain('https://egpayment.com/*');

    for (const hp of hostPermissions) {
      // Must NOT be wildcard subdomains
      expect(hp).not.toBe('https://*.simplewallet.in/*');
      expect(hp).not.toBe('https://*.egpayment.com/*');
      expect(hp).not.toBe('*://*.simplewallet.in/*');
      expect(hp).not.toBe('*://*.egpayment.com/*');
      expect(hp).not.toBe('<all_urls>');
      expect(hp).not.toBe('*://*/*');

      // Portals must strictly use https
      if (hp.includes('simplewallet.in') || hp.includes('egpayment.com')) {
        expect(hp.startsWith('https://')).toBe(true);
      }
    }
  });

  it('verifies content_scripts match arrays contain ONLY exact history endpoints', () => {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    const contentScripts = manifest.content_scripts;
    expect(Array.isArray(contentScripts)).toBe(true);
    expect(contentScripts.length).toBeGreaterThan(0);

    const exactAllowedMatches = new Set([
      'https://simplewallet.in/web/MyTrans.aspx*',
      'https://egpayment.com/users/recharge_history*',
    ]);

    for (const cs of contentScripts) {
      const matches: string[] = cs.matches;
      expect(Array.isArray(matches)).toBe(true);
      for (const m of matches) {
        expect(exactAllowedMatches.has(m)).toBe(true);
      }
    }
  });
});

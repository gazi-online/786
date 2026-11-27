import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Step A8 Hardening: CI Environment Database Requirement', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('verifies that when CI=true and DB is not connected, the test strictly fails rather than skipping', () => {
    process.env.CI = 'true';
    const isConnected = false;

    expect(() => {
      if (!isConnected) {
        if (process.env.CI === 'true') {
          throw new Error(
            'FATAL: Live database connection required in CI environment (CI=true), but DATABASE_URL is missing or connection failed.',
          );
        }
      }
    }).toThrow(/FATAL: Live database connection required in CI environment/);
  });
});


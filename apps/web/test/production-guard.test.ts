import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateEnvironmentAndDatabaseConfig } from '@/lib/db';

describe('Step 2 Hardening: Production Guard & In-Memory Store Policy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails boot in production when neither DATABASE_URL nor SUPABASE_DB_URL is set', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.ALLOW_IN_MEMORY_STORE;

    expect(() => validateEnvironmentAndDatabaseConfig()).toThrow(
      /FATAL: Production requires DATABASE_URL or SUPABASE_DB_URL/,
    );
  });

  it('fails boot in production when ALLOW_IN_MEMORY_STORE is set', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/walletsync';
    process.env.ALLOW_IN_MEMORY_STORE = 'true';

    expect(() => validateEnvironmentAndDatabaseConfig()).toThrow(
      /FATAL: ALLOW_IN_MEMORY_STORE is strictly forbidden in production/,
    );
  });

  it('succeeds in production when valid DATABASE_URL is set without ALLOW_IN_MEMORY_STORE', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/walletsync';
    delete process.env.ALLOW_IN_MEMORY_STORE;

    const res = validateEnvironmentAndDatabaseConfig();
    expect(res.isProduction).toBe(true);
    expect(res.allowMemoryFallback).toBe(false);
  });

  it('allows in-memory fallback in development only when explicit flag ALLOW_IN_MEMORY_STORE=true is set', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    process.env.ALLOW_IN_MEMORY_STORE = 'true';

    const res = validateEnvironmentAndDatabaseConfig();
    expect(res.isProduction).toBe(false);
    expect(res.allowMemoryFallback).toBe(true);
  });

  it('disables in-memory fallback in development when ALLOW_IN_MEMORY_STORE is not set', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    delete process.env.ALLOW_IN_MEMORY_STORE;

    const res = validateEnvironmentAndDatabaseConfig();
    expect(res.isProduction).toBe(false);
    expect(res.allowMemoryFallback).toBe(false);
  });

  describe('Next.js Phase-Aware Production Boot Guard', () => {
    it('sets dummy DATABASE_URL only during PHASE_PRODUCTION_BUILD if absent', async () => {
      const nextConfigModule = await import('../next.config');
      const nextConfigFn = nextConfigModule.default;

      delete process.env.DATABASE_URL;
      delete process.env.SUPABASE_DB_URL;

      const conf = nextConfigFn('phase-production-build');
      expect(conf).toBeDefined();
      expect(process.env.DATABASE_URL).toContain('dummy_build');
    });

    it('refuses to boot at PHASE_PRODUCTION_SERVER with no database URL', async () => {
      const nextConfigModule = await import('../next.config');
      const nextConfigFn = nextConfigModule.default;

      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      delete process.env.SUPABASE_DB_URL;
      delete process.env.ALLOW_IN_MEMORY_STORE;

      expect(() => nextConfigFn('phase-production-server')).toThrow(
        /FATAL: Production requires DATABASE_URL or SUPABASE_DB_URL/,
      );
    });

    it('refuses to boot at PHASE_PRODUCTION_SERVER if ALLOW_IN_MEMORY_STORE is set', async () => {
      const nextConfigModule = await import('../next.config');
      const nextConfigFn = nextConfigModule.default;

      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/walletsync';
      process.env.ALLOW_IN_MEMORY_STORE = 'true';

      expect(() => nextConfigFn('phase-production-server')).toThrow(
        /FATAL: ALLOW_IN_MEMORY_STORE is strictly forbidden in production/,
      );
    });
  });
});


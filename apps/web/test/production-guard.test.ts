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
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.ALLOW_IN_MEMORY_STORE;

    expect(() => validateEnvironmentAndDatabaseConfig()).toThrow(
      /FATAL: Production requires DATABASE_URL or SUPABASE_DB_URL/,
    );
  });

  it('fails boot in production when ALLOW_IN_MEMORY_STORE is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/walletsync';
    process.env.ALLOW_IN_MEMORY_STORE = 'true';

    expect(() => validateEnvironmentAndDatabaseConfig()).toThrow(
      /FATAL: ALLOW_IN_MEMORY_STORE is strictly forbidden in production/,
    );
  });

  it('succeeds in production when valid DATABASE_URL is set without ALLOW_IN_MEMORY_STORE', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/walletsync';
    delete process.env.ALLOW_IN_MEMORY_STORE;

    const res = validateEnvironmentAndDatabaseConfig();
    expect(res.isProduction).toBe(true);
    expect(res.allowMemoryFallback).toBe(false);
  });

  it('allows in-memory fallback in development only when explicit flag ALLOW_IN_MEMORY_STORE=true is set', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_IN_MEMORY_STORE = 'true';

    const res = validateEnvironmentAndDatabaseConfig();
    expect(res.isProduction).toBe(false);
    expect(res.allowMemoryFallback).toBe(true);
  });

  it('disables in-memory fallback in development when ALLOW_IN_MEMORY_STORE is not set', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_IN_MEMORY_STORE;

    const res = validateEnvironmentAndDatabaseConfig();
    expect(res.isProduction).toBe(false);
    expect(res.allowMemoryFallback).toBe(false);
  });
});


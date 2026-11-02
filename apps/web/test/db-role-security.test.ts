import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertRuntimeRoleSecurity } from '@/lib/db';

describe('Round 10 Step 5: Database Runtime Role Security Check', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('throws fatal error in production when connected role has BYPASSRLS', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.NEXT_PHASE;

    const mockClient = vi.fn().mockImplementation((queryStrings: TemplateStringsArray) => {
      const q = queryStrings.join('');
      if (q.includes('pg_roles')) {
        return Promise.resolve([{ rolname: 'superuser', rolbypassrls: true }]);
      }
      if (q.includes('pg_tables')) {
        return Promise.resolve([{ tablename: 'transactions', tableowner: 'postgres' }]);
      }
      return Promise.resolve([]);
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    type MockClient = Parameters<typeof assertRuntimeRoleSecurity>[0];

    await expect(assertRuntimeRoleSecurity(mockClient as unknown as MockClient)).rejects.toThrow(
      /FATAL: Connected database role "superuser" has BYPASSRLS/,
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('FATAL: Connected database role "superuser" has BYPASSRLS'),
    );
  });

  it('throws fatal error in production when connected role owns transactions table', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.NEXT_PHASE;

    const mockClient = vi.fn().mockImplementation((queryStrings: TemplateStringsArray) => {
      const q = queryStrings.join('');
      if (q.includes('pg_roles')) {
        return Promise.resolve([{ rolname: 'table_owner', rolbypassrls: false }]);
      }
      if (q.includes('pg_tables')) {
        return Promise.resolve([{ tablename: 'transactions', tableowner: 'table_owner' }]);
      }
      return Promise.resolve([]);
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    type MockClient = Parameters<typeof assertRuntimeRoleSecurity>[0];

    await expect(assertRuntimeRoleSecurity(mockClient as unknown as MockClient)).rejects.toThrow(
      /FATAL: Connected database role "table_owner" owns table "transactions"/,
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('FATAL: Connected database role "table_owner" owns table "transactions"'),
    );
  });

  it('succeeds in production when role is non-owner and has NOBYPASSRLS', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.NEXT_PHASE;

    const mockClient = vi.fn().mockImplementation((queryStrings: TemplateStringsArray) => {
      const q = queryStrings.join('');
      if (q.includes('pg_roles')) {
        return Promise.resolve([{ rolname: 'walletsync_app', rolbypassrls: false }]);
      }
      if (q.includes('pg_tables')) {
        return Promise.resolve([{ tablename: 'transactions', tableowner: 'postgres' }]);
      }
      return Promise.resolve([]);
    });

    type MockClient = Parameters<typeof assertRuntimeRoleSecurity>[0];

    await expect(assertRuntimeRoleSecurity(mockClient as unknown as MockClient)).resolves.not.toThrow();
  });
});


/**
 * Test Database Safety Guard:
 * All live DB tests MUST use TEST_DATABASE_URL and strictly IGNORE DATABASE_URL.
 * If TEST_DATABASE_URL equals DATABASE_URL, tests refuse to run and throw a fatal error.
 */
export function getTestDatabaseUrl(): { testDbUrl: string | null; hasTestDatabase: boolean } {
  const testDbUrl = process.env.TEST_DATABASE_URL?.trim() || null;
  const prodDbUrl = process.env.DATABASE_URL?.trim() || null;

  if (testDbUrl && prodDbUrl && testDbUrl === prodDbUrl) {
    throw new Error(
      'FATAL SAFETY BREACH: TEST_DATABASE_URL is identical to DATABASE_URL. Live DB tests must never touch production or shared database. Use a dedicated throwaway database or branch.',
    );
  }

  return {
    testDbUrl,
    hasTestDatabase: Boolean(testDbUrl),
  };
}


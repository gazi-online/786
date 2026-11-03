/**
 * Database Seeder:
 * In production and standard operation, no demo/sample data is auto-seeded.
 * Transactions are created strictly via live ingest (/api/v1/ingest) from connected POS extension.
 */

export async function seedDatabaseTransactions(
  _tenantId: string,
  _deviceId?: string,
): Promise<void> {
  // Demo data removed: No synthetic transactions are seeded into database.
}

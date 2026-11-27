import dotenv from 'dotenv';
dotenv.config({ path: 'apps/web/.env.local' });
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  console.log('Tables:', tables.map(t => t.table_name));

  const pairings = await sql`SELECT * FROM pairing_codes ORDER BY created_at DESC LIMIT 5`;
  console.log('Recent pairing codes:', pairings);

  const devs = await sql`SELECT * FROM devices ORDER BY created_at DESC LIMIT 5`;
  console.log('Recent devices:', devs);
}

main().catch(console.error);


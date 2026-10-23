import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client.js';

/** Runs as the owner role (DATABASE_OWNER_URL), never as scm_app. */
async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  const pool = createPool(url, 1);
  try {
    await migrate(createDb(pool), { migrationsFolder: path.join(__dirname, '..', 'migrations') });
    console.log('migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

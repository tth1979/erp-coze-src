import { readFileSync } from 'node:fs';
import { Client } from 'pg';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: tsx scripts/apply-migration.ts <file.sql>');
    process.exit(1);
  }
  const sql = readFileSync(file, 'utf8');
  const client = new Client({ connectionString: process.env.PGDATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('MIGRATION_OK', file);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('MIGRATION_FAILED', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void main();

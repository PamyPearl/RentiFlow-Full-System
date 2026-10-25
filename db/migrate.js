import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabasePool } from '../src/db/pool.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not configured.');
  console.error('Create a .env file from .env.example and set it to your local PostgreSQL connection string.');
  console.error('Example: DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/rentiflow_development');
  process.exitCode = 1;
  process.exit();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(__dirname, 'migrations');
const pool = getDatabasePool();

try {
  const migrationNames = (await fs.readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const migrationName of migrationNames) {
    const migration = await fs.readFile(path.join(migrationsDirectory, migrationName), 'utf8');
    await pool.query(migration);
    console.log(`Applied ${migrationName}`);
  }
} finally {
  await pool.end();
}

import pg from 'pg';

const { Pool } = pg;

let pool;

export function getDatabasePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required before using PostgreSQL persistence');
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });

  return pool;
}

export async function checkDatabaseConnection() {
  const database = getDatabasePool();
  const client = await database.connect();

  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

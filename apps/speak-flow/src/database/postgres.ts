import { Pool, type PoolConfig } from 'pg';

export type PostgresPool = Pick<Pool, 'connect' | 'end' | 'query'>;

export function createPostgresPool(
  connectionString = process.env['DATABASE_URL'],
  overrides: PoolConfig = {},
): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
  }

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides,
  });
}

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { createPostgresPool, type PostgresPool } from './postgres';

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

type Migration = {
  readonly name: string;
  readonly sql: string;
};

type MigrationClient = Pick<PoolClient, 'query' | 'release'>;

export async function loadMigrations(
  directory = migrationsDirectory,
): Promise<Migration[]> {
  const names = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(join(directory, name), 'utf8'),
    })),
  );
}

export async function runMigrations(
  pool: PostgresPool,
  migrations: readonly Migration[],
): Promise<string[]> {
  const client = (await pool.connect()) as MigrationClient;
  const applied: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const migration of migrations) {
      const existing = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [migration.name],
      );
      if (existing.rowCount) continue;

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
          migration.name,
        ]);
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }

  return applied;
}

async function main(): Promise<void> {
  const pool = createPostgresPool();
  try {
    const applied = await runMigrations(pool, await loadMigrations());
    console.info(
      applied.length
        ? `Applied migrations: ${applied.join(', ')}`
        : 'Database schema is up to date.',
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error('Database migration failed:', error);
    process.exitCode = 1;
  });
}

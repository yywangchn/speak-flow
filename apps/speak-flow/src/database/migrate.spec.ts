import { describe, expect, it, vi } from 'vitest';
import type { PostgresPool } from './postgres';
import { loadMigrations, runMigrations } from './migrate';

describe('PostgreSQL migrations', () => {
  it('loads the initial pgvector schema', async () => {
    const migrations = await loadMigrations();

    expect(migrations.map(({ name }) => name)).toEqual(['001_initial.sql']);
    expect(migrations[0]?.sql).toContain(
      'CREATE EXTENSION IF NOT EXISTS vector',
    );
    expect(migrations[0]?.sql).toContain('embedding VECTOR(1024)');
    expect(migrations[0]?.sql).toContain('USING hnsw');
  });

  it('applies pending migrations in a transaction', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValue({ rowCount: null });
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as PostgresPool;

    await expect(
      runMigrations(pool, [{ name: '001_test.sql', sql: 'SELECT 1' }]),
    ).resolves.toEqual(['001_test.sql']);

    expect(query.mock.calls.map(([sql]) => String(sql).trim())).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      'BEGIN',
      'SELECT 1',
      'INSERT INTO schema_migrations (name) VALUES ($1)',
      'COMMIT',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the client when a migration fails', async () => {
    const migrationError = new Error('invalid migration');
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: null })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: null })
      .mockRejectedValueOnce(migrationError)
      .mockResolvedValueOnce({ rowCount: null });
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as PostgresPool;

    await expect(
      runMigrations(pool, [{ name: '001_test.sql', sql: 'INVALID' }]),
    ).rejects.toThrow('invalid migration');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});

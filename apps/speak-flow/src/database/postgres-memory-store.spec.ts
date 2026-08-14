import { describe, expect, it, vi } from 'vitest';
import type { PostgresPool } from './postgres';
import { findRelevantPostgresMemories } from './postgres-memory-store';

describe('PostgreSQL memory retrieval', () => {
  it('delegates filtered top-k cosine search to pgvector', async () => {
    const now = new Date('2026-08-14T00:00:00.000Z');
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'memory-1',
          user_id: 'user-1',
          content: 'The user is preparing for an AI interview.',
          category: 'goal',
          source: 'conversation',
          confidence: 0.95,
          created_at: now,
          updated_at: now,
          similarity: 0.82,
        },
      ],
    });

    const memories = await findRelevantPostgresMemories(
      'user-1',
      [1, 0, 0],
      { limit: 3, minimumSimilarity: 0.35 },
      { query } as unknown as Pick<PostgresPool, 'query'>,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY embedding <=> $2::vector'),
      ['user-1', '[1,0,0]', 'text-embedding-v4', 0.35, 3],
    );
    expect(memories).toEqual([
      expect.objectContaining({ id: 'memory-1', similarity: 0.82 }),
    ]);
  });

  it('does not query PostgreSQL for a non-positive limit', async () => {
    const query = vi.fn();

    await expect(
      findRelevantPostgresMemories('user-1', [1, 0], { limit: 0 }, {
        query,
      } as unknown as Pick<PostgresPool, 'query'>),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

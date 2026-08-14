import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listRecentPostgresMessages,
  savePostgresChatMessage,
} from './postgres-chat-store';
import {
  findRelevantPostgresMemories,
  listPostgresMemories,
  savePostgresMemories,
} from './postgres-memory-store';
import { loadMigrations, runMigrations } from './migrate';
import { getPostgresPool } from './postgres';
import type { ExtractedMemory } from '../memory-extraction';

const describePostgres =
  process.env['RUN_POSTGRES_TESTS'] === 'true' ? describe : describe.skip;

describePostgres('PostgreSQL persistence integration', () => {
  const firstUserId = randomUUID();
  const secondUserId = randomUUID();
  let pool!: ReturnType<typeof getPostgresPool>;
  const firstVector = unitVector(0);
  const secondVector = unitVector(1);

  beforeAll(async () => {
    pool = getPostgresPool();
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES
       ($1, $2, 'integration-test'), ($3, $4, 'integration-test')`,
      [
        firstUserId,
        `${firstUserId}@integration.test`,
        secondUserId,
        `${secondUserId}@integration.test`,
      ],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      [firstUserId, secondUserId],
    ]);
  });

  it('keeps chat history and memories isolated by authenticated user', async () => {
    await savePostgresChatMessage(firstUserId, 'user', 'First user message');
    await savePostgresChatMessage(secondUserId, 'user', 'Second user message');
    await savePostgresMemories(
      firstUserId,
      [
        durableMemory(
          'goal.first',
          'The first user is preparing for an interview.',
        ),
      ],
      [{ vector: firstVector, model: 'text-embedding-v4' }],
    );
    await savePostgresMemories(
      secondUserId,
      [durableMemory('goal.second', 'The second user is learning TypeScript.')],
      [{ vector: firstVector, model: 'text-embedding-v4' }],
    );

    const [messages, memories, relevant] = await Promise.all([
      listRecentPostgresMessages(firstUserId),
      listPostgresMemories(firstUserId),
      findRelevantPostgresMemories(firstUserId, firstVector),
    ]);

    expect(messages.map(({ content }) => content)).toEqual([
      'First user message',
    ]);
    expect(memories.map(({ content }) => content)).toEqual([
      'The first user is preparing for an interview.',
    ]);
    expect(relevant.map(({ content }) => content)).not.toContain(
      'The second user is learning TypeScript.',
    );
  });

  it('applies similarity threshold and top-k inside pgvector', async () => {
    await savePostgresMemories(
      firstUserId,
      [
        durableMemory(
          'project.relevant',
          'The user builds an AI chat application.',
          'project',
        ),
        durableMemory(
          'preference.unrelated',
          'The user prefers tea.',
          'preference',
        ),
      ],
      [
        { vector: firstVector, model: 'text-embedding-v4' },
        { vector: secondVector, model: 'text-embedding-v4' },
      ],
    );

    const results = await findRelevantPostgresMemories(
      firstUserId,
      firstVector,
      { limit: 1, minimumSimilarity: 0.8 },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.content).toBe('The user builds an AI chat application.');
    expect(results[0]?.similarity).toBeCloseTo(1);
  });

  it('replaces a stale embedding when keyed memory content changes', async () => {
    await savePostgresMemories(
      firstUserId,
      [
        durableMemory(
          'habit.practice',
          'The user practices English in the morning.',
          'habit',
        ),
      ],
      [{ vector: firstVector, model: 'text-embedding-v4' }],
    );
    await savePostgresMemories(
      firstUserId,
      [
        durableMemory(
          'habit.practice',
          'The user practices English at night.',
          'habit',
        ),
      ],
      [{ vector: secondVector, model: 'text-embedding-v4' }],
    );

    const [oldVectorResults, newVectorResults] = await Promise.all([
      findRelevantPostgresMemories(firstUserId, firstVector, {
        minimumSimilarity: 0.8,
      }),
      findRelevantPostgresMemories(firstUserId, secondVector, {
        minimumSimilarity: 0.8,
      }),
    ]);

    expect(oldVectorResults.map(({ content }) => content)).not.toContain(
      'The user practices English at night.',
    );
    expect(newVectorResults.map(({ content }) => content)).toContain(
      'The user practices English at night.',
    );
  });

  it('can rerun all schema migrations without applying duplicates', async () => {
    await expect(runMigrations(pool, await loadMigrations())).resolves.toEqual(
      [],
    );
  });
});

function unitVector(activeIndex: number): number[] {
  return Array.from({ length: 1024 }, (_, index) =>
    index === activeIndex ? 1 : 0,
  );
}

function durableMemory(
  key: string,
  content: string,
  category: ExtractedMemory['category'] = 'goal',
): ExtractedMemory {
  return { key, content, category, confidence: 0.95 };
}

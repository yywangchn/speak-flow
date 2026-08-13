import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDirectory = mkdtempSync(join(tmpdir(), 'speak-flow-memory-'));
const testDatabasePath = join(testDirectory, 'test.sqlite');

process.env['SPEAKFLOW_DATABASE_PATH'] = testDatabasePath;

let memoryStore: typeof import('./memory-store');

beforeAll(async () => {
  const legacyDatabase = new Database(testDatabasePath);
  legacyDatabase.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      memory_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, content)
    );
  `);
  legacyDatabase.close();
  memoryStore = await import('./memory-store');
});

afterAll(() => {
  delete process.env['SPEAKFLOW_DATABASE_PATH'];
  rmSync(testDirectory, { recursive: true, force: true });
});

describe('memory store', () => {
  it('adds embedding columns to an existing database', () => {
    const database = new Database(testDatabasePath, { readonly: true });

    const columns = database
      .prepare("PRAGMA table_info('memories')")
      .all() as Array<{ name: string }>;

    database.close();

    expect(columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['embedding', 'embedding_model']),
    );
  });

  it('backfills a rule memory key and replaces the previous value', () => {
    const userId = 'test-user';
    memoryStore.extractMemories(userId, 'My name is Wang.');
    memoryStore.saveExtractedMemories(userId, [
      {
        key: 'profile.name',
        content: "The user's name is Wang.",
        category: 'profile',
        confidence: 0.98,
      },
    ]);
    memoryStore.saveExtractedMemories(userId, [
      {
        key: 'profile.name',
        content: "The user's name is Li.",
        category: 'profile',
        confidence: 0.99,
      },
    ]);

    expect(memoryStore.listMemories(userId)).toEqual([
      expect.objectContaining({
        content: "The user's name is Li.",
        category: 'profile',
        confidence: 0.99,
      }),
    ]);
  });

  it('stores an embedding with an extracted memory', () => {
    memoryStore.saveExtractedMemories(
      'embedding-user',
      [
        {
          key: 'goal.career',
          content: 'The user is preparing for a frontend interview.',
          category: 'goal',
          confidence: 0.95,
        },
      ],
      [{ vector: [0.1, 0.2], model: 'text-embedding-v4' }],
    );

    const database = new Database(testDatabasePath, { readonly: true });
    const row = database
      .prepare(
        'SELECT embedding, embedding_model FROM memories WHERE user_id = ?',
      )
      .get('embedding-user') as {
      embedding: string;
      embedding_model: string;
    };
    database.close();

    expect(JSON.parse(row.embedding)).toEqual([0.1, 0.2]);
    expect(row.embedding_model).toBe('text-embedding-v4');
  });

  it('clears a stale embedding when keyed memory content changes without a new vector', () => {
    const userId = 'stale-embedding-user';
    memoryStore.saveExtractedMemories(
      userId,
      [
        {
          key: 'profile.name',
          content: "The user's name is Wang.",
          category: 'profile',
          confidence: 0.98,
        },
      ],
      [{ vector: [0.1, 0.2], model: 'text-embedding-v4' }],
    );

    memoryStore.saveExtractedMemories(userId, [
      {
        key: 'profile.name',
        content: "The user's name is Li.",
        category: 'profile',
        confidence: 0.99,
      },
    ]);

    const database = new Database(testDatabasePath, { readonly: true });
    const row = database
      .prepare(
        'SELECT content, embedding, embedding_model FROM memories WHERE user_id = ?',
      )
      .get(userId) as {
      content: string;
      embedding: string | null;
      embedding_model: string | null;
    };
    database.close();

    expect(row).toEqual({
      content: "The user's name is Li.",
      embedding: null,
      embedding_model: null,
    });
  });

  it('replaces a stale embedding when keyed memory content changes with a new vector', () => {
    const userId = 'updated-embedding-user';
    memoryStore.saveExtractedMemories(
      userId,
      [
        {
          key: 'profile.name',
          content: "The user's name is Wang.",
          category: 'profile',
          confidence: 0.98,
        },
      ],
      [{ vector: [0.1, 0.2], model: 'text-embedding-v4' }],
    );

    memoryStore.saveExtractedMemories(
      userId,
      [
        {
          key: 'profile.name',
          content: "The user's name is Li.",
          category: 'profile',
          confidence: 0.99,
        },
      ],
      [{ vector: [0.8, 0.9], model: 'text-embedding-v4' }],
    );

    const database = new Database(testDatabasePath, { readonly: true });
    const row = database
      .prepare(
        'SELECT content, embedding, embedding_model FROM memories WHERE user_id = ?',
      )
      .get(userId) as {
      content: string;
      embedding: string;
      embedding_model: string;
    };
    database.close();

    expect(row.content).toBe("The user's name is Li.");
    expect(JSON.parse(row.embedding)).toEqual([0.8, 0.9]);
    expect(row.embedding_model).toBe('text-embedding-v4');
  });

  it('keeps an embedding when the same keyed content is saved without a new vector', () => {
    const userId = 'same-content-user';
    const memory = {
      key: 'profile.name' as const,
      content: "The user's name is Wang.",
      category: 'profile' as const,
      confidence: 0.98,
    };

    memoryStore.saveExtractedMemories(
      userId,
      [memory],
      [{ vector: [0.1, 0.2], model: 'text-embedding-v4' }],
    );
    memoryStore.saveExtractedMemories(userId, [memory]);

    const database = new Database(testDatabasePath, { readonly: true });
    const row = database
      .prepare(
        'SELECT embedding, embedding_model FROM memories WHERE user_id = ?',
      )
      .get(userId) as { embedding: string; embedding_model: string };
    database.close();

    expect(JSON.parse(row.embedding)).toEqual([0.1, 0.2]);
    expect(row.embedding_model).toBe('text-embedding-v4');
  });

  it('returns relevant memories sorted by similarity and limited to top results', () => {
    const userId = 'retrieval-user';
    memoryStore.saveExtractedMemories(
      userId,
      [
        {
          key: 'goal.one',
          content: 'The user is preparing for interviews.',
          category: 'goal',
          confidence: 0.95,
        },
        {
          key: 'goal.two',
          content: 'The user practices English every day.',
          category: 'goal',
          confidence: 0.95,
        },
        {
          key: 'preference.food',
          content: 'The user prefers pizza.',
          category: 'preference',
          confidence: 0.95,
        },
      ],
      [
        { vector: [1, 0], model: 'text-embedding-v4' },
        { vector: [0.8, 0.6], model: 'text-embedding-v4' },
        { vector: [0, 1], model: 'text-embedding-v4' },
      ],
    );

    const results = memoryStore.findRelevantMemories(userId, [1, 0], {
      limit: 2,
      minimumSimilarity: 0.7,
    });

    expect(results.map(({ content }) => content)).toEqual([
      'The user is preparing for interviews.',
      'The user practices English every day.',
    ]);
    expect(results[0]?.similarity).toBeCloseTo(1);
    expect(results[1]?.similarity).toBeCloseTo(0.8);
  });

  it('ignores invalid, mismatched, and low-similarity embeddings', () => {
    const userId = 'invalid-retrieval-user';
    memoryStore.saveExtractedMemories(
      userId,
      [
        {
          key: 'goal.valid',
          content: 'Valid memory.',
          category: 'goal',
          confidence: 0.95,
        },
      ],
      [{ vector: [1, 0], model: 'text-embedding-v4' }],
    );

    const database = new Database(testDatabasePath);
    database
      .prepare(
        'INSERT INTO memories (id, user_id, content, category, source, confidence, embedding, embedding_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'invalid-memory',
        userId,
        'Invalid memory.',
        'goal',
        'conversation',
        0.95,
        'not-json',
        'text-embedding-v4',
        new Date().toISOString(),
        new Date().toISOString(),
      );
    database
      .prepare(
        'INSERT INTO memories (id, user_id, content, category, source, confidence, embedding, embedding_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'mismatched-memory',
        userId,
        'Mismatched memory.',
        'goal',
        'conversation',
        0.95,
        JSON.stringify([1, 0, 0]),
        'text-embedding-v4',
        new Date().toISOString(),
        new Date().toISOString(),
      );
    database
      .prepare(
        'INSERT INTO memories (id, user_id, content, category, source, confidence, embedding, embedding_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'low-similarity-memory',
        userId,
        'Low similarity memory.',
        'goal',
        'conversation',
        0.95,
        JSON.stringify([0, 1]),
        'text-embedding-v4',
        new Date().toISOString(),
        new Date().toISOString(),
      );
    database.close();

    const results = memoryStore.findRelevantMemories(userId, [1, 0]);

    expect(results.map(({ content }) => content)).toEqual(['Valid memory.']);
  });
});

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
});

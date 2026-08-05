import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDirectory = mkdtempSync(join(tmpdir(), 'speak-flow-memory-'));
process.env['SPEAKFLOW_DATABASE_PATH'] = join(testDirectory, 'test.sqlite');

let memoryStore: typeof import('./memory-store');

beforeAll(async () => {
  memoryStore = await import('./memory-store');
});

afterAll(() => {
  delete process.env['SPEAKFLOW_DATABASE_PATH'];
  rmSync(testDirectory, { recursive: true, force: true });
});

describe('memory store', () => {
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

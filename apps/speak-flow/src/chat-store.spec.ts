import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDirectory = mkdtempSync(join(tmpdir(), 'speak-flow-chat-'));
process.env['SPEAKFLOW_DATABASE_PATH'] = join(testDirectory, 'test.sqlite');

let chatStore: typeof import('./chat-store');

beforeAll(async () => {
  chatStore = await import('./chat-store');
});

afterAll(() => {
  delete process.env['SPEAKFLOW_DATABASE_PATH'];
  rmSync(testDirectory, { recursive: true, force: true });
});

describe('chat store', () => {
  it('saves messages in order and limits restored messages', () => {
    const userId = 'test-user';
    chatStore.saveChatMessage(userId, 'user', 'First question');
    chatStore.saveChatMessage(userId, 'assistant', 'First answer');
    chatStore.saveChatMessage(userId, 'user', 'Second question');
    chatStore.saveChatMessage(userId, 'assistant', 'Second answer');

    expect(
      chatStore.listRecentMessages(userId, 2).map(({ content }) => content),
    ).toEqual(['Second question', 'Second answer']);
  });

  it('keeps a user message without an assistant reply', () => {
    const userId = 'failed-reply-user';

    chatStore.saveChatMessage(userId, 'user', 'Please remember this attempt.');

    expect(chatStore.listRecentMessages(userId)).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Please remember this attempt.',
      }),
    ]);
  });
});

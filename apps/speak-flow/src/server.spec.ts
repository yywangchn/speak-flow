import '@angular/compiler';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDirectory = mkdtempSync(join(tmpdir(), 'speak-flow-server-'));
process.env['SPEAKFLOW_DATABASE_PATH'] = join(testDirectory, 'test.sqlite');
process.env['DEEPSEEK_API_KEY'] = 'test-deepseek-key';
process.env['DASHSCOPE_API_KEY'] = 'test-dashscope-key';
process.env['DASHSCOPE_BASE_URL'] = 'https://embedding.example.com';

let handleChat: (typeof import('./server'))['handleChat'];
let memoryStore: typeof import('./memory-store');
let deepSeekPrompt = '';

beforeAll(async () => {
  const serverModule = await import('./server');
  handleChat = serverModule.handleChat;
  memoryStore = await import('./memory-store');
});

afterAll(async () => {
  delete process.env['SPEAKFLOW_DATABASE_PATH'];
  delete process.env['DEEPSEEK_API_KEY'];
  delete process.env['DASHSCOPE_API_KEY'];
  delete process.env['DASHSCOPE_BASE_URL'];
  rmSync(testDirectory, { recursive: true, force: true });
});

describe('chat API memory retrieval', () => {
  it('injects only relevant memories into the chat prompt', async () => {
    const userId = 'retrieval-test-user';
    memoryStore.saveExtractedMemories(
      userId,
      [
        {
          key: 'goal.interview',
          content: 'The user is preparing for a frontend interview.',
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
        { vector: [0, 1], model: 'text-embedding-v4' },
      ],
    );

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = input.toString();
        const body = JSON.parse(String(init?.body)) as {
          temperature?: number;
          messages?: Array<{ content?: string }>;
        };
        if (url === 'https://embedding.example.com/embeddings') {
          return new Response(
            JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }),
            { status: 200 },
          );
        }
        if (body.temperature === 0.8) {
          deepSeekPrompt = body.messages?.[0]?.content ?? '';
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Let us practice.' } }],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"memories":[]}' } }],
          }),
          { status: 200 },
        );
      });
    const infoMock = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);

    let status = 200;
    let responseBody: unknown;
    await handleChat(
      {
        body: {
          userId,
          messages: [
            {
              role: 'user',
              content: 'How should I prepare for my interview?',
            },
          ],
        },
      },
      {
        status(code) {
          status = code;
          return this;
        },
        json(body) {
          responseBody = body;
        },
      },
    );

    fetchMock.mockRestore();
    infoMock.mockRestore();

    expect(status).toBe(200);
    expect(responseBody).toEqual({ reply: 'Let us practice.' });
    expect(deepSeekPrompt).toContain(
      'The user is preparing for a frontend interview.',
    );
    expect(deepSeekPrompt).not.toContain('The user prefers pizza.');
  });
});

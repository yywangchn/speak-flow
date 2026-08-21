import '@angular/compiler';
import type { Response } from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from './auth-http';
import type { CosyVoiceOptions } from './cosyvoice-client';

const testDirectory = mkdtempSync(join(tmpdir(), 'speak-flow-server-'));
process.env['SPEAKFLOW_DATABASE_PATH'] = join(testDirectory, 'test.sqlite');
process.env['SPEAKFLOW_PERSISTENCE'] = 'sqlite';
process.env['DEEPSEEK_API_KEY'] = 'test-deepseek-key';
process.env['DASHSCOPE_API_KEY'] = 'test-dashscope-key';
process.env['DASHSCOPE_BASE_URL'] = 'https://embedding.example.com';

let handleChat: (typeof import('./server'))['handleChat'];
let handleChatStream: (typeof import('./server'))['handleChatStream'];
let handleHealth: (typeof import('./server'))['handleHealth'];
let handleSpeech: (typeof import('./server'))['handleSpeech'];
let handleSpeechAudioStream: (typeof import('./server'))['handleSpeechAudioStream'];
let memoryStore: typeof import('./memory-store');
let chatStore: typeof import('./chat-store');
let deepSeekPrompt = '';

beforeAll(async () => {
  const serverModule = await import('./server');
  handleChat = serverModule.handleChat;
  handleChatStream = serverModule.handleChatStream;
  handleHealth = serverModule.handleHealth;
  handleSpeech = serverModule.handleSpeech;
  handleSpeechAudioStream = serverModule.handleSpeechAudioStream;
  memoryStore = await import('./memory-store');
  chatStore = await import('./chat-store');
});

describe('speech API', () => {
  it('returns generated MP3 audio for an authenticated user', async () => {
    const audio = Buffer.from('test-mp3');
    const synthesize = vi.fn(async () => audio);
    const setHeader = vi.fn();
    const send = vi.fn();

    await handleSpeech(
      {
        userId: 'speech-user',
        body: { text: '  Hello there.  ' },
        on: vi.fn(),
      } as unknown as AuthenticatedRequest,
      {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        setHeader,
        send,
      } as unknown as Response,
      synthesize,
    );

    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-dashscope-key',
        text: 'Hello there.',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(send).toHaveBeenCalledWith(audio);
  });

  it.each([
    { userId: undefined, text: 'Hello.', expectedStatus: 401 },
    { userId: 'speech-user', text: '   ', expectedStatus: 400 },
    { userId: 'speech-user', text: 'a'.repeat(2001), expectedStatus: 400 },
  ])(
    'rejects an invalid speech request with $expectedStatus',
    async ({ userId, text, expectedStatus }) => {
      const synthesize = vi.fn();
      const status = vi.fn().mockReturnThis();

      await handleSpeech(
        {
          userId,
          body: { text },
          on: vi.fn(),
        } as unknown as AuthenticatedRequest,
        { status, json: vi.fn() } as unknown as Response,
        synthesize,
      );

      expect(status).toHaveBeenCalledWith(expectedStatus);
      expect(synthesize).not.toHaveBeenCalled();
    },
  );

  it('returns a recoverable error when CosyVoice fails', async () => {
    const synthesize = vi.fn(async () => {
      throw new Error('Upstream unavailable');
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await handleSpeech(
      {
        userId: 'speech-user',
        body: { text: 'Hello.' },
        on: vi.fn(),
      } as unknown as AuthenticatedRequest,
      { status, json } as unknown as Response,
      synthesize,
    );

    error.mockRestore();
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({
      error: 'Speech could not be generated.',
    });
  });

  it('forwards CosyVoice audio chunks without waiting for completion', async () => {
    const writtenChunks: Buffer[] = [];
    const stream = async (
      _options: CosyVoiceOptions,
      onAudioChunk: (chunk: Buffer) => void,
    ): Promise<void> => {
      onAudioChunk(Buffer.from('first'));
      onAudioChunk(Buffer.from('second'));
    };
    const end = vi.fn();
    const setHeader = vi.fn();

    await handleSpeechAudioStream(
      {
        userId: 'speech-user',
        body: { text: 'Hello there.' },
        on: vi.fn(),
      } as unknown as AuthenticatedRequest,
      {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        setHeader,
        write: (chunk: Buffer) => {
          writtenChunks.push(chunk);
          return true;
        },
        end,
      } as unknown as Parameters<typeof handleSpeechAudioStream>[1],
      stream,
    );

    expect(writtenChunks.map((chunk) => chunk.toString())).toEqual([
      'first',
      'second',
    ]);
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
    expect(setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(end).toHaveBeenCalledOnce();
  });
});

afterAll(async () => {
  delete process.env['SPEAKFLOW_DATABASE_PATH'];
  delete process.env['SPEAKFLOW_PERSISTENCE'];
  delete process.env['DEEPSEEK_API_KEY'];
  delete process.env['DASHSCOPE_API_KEY'];
  delete process.env['DASHSCOPE_BASE_URL'];
  rmSync(testDirectory, { recursive: true, force: true });
});

describe('chat API memory retrieval', () => {
  it('reports that the server process is healthy without authentication', () => {
    let responseBody: unknown;

    handleHealth(undefined, {
      status() {
        return this;
      },
      json(body) {
        responseBody = body;
      },
    });

    expect(responseBody).toEqual({ status: 'ok' });
  });

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
    const warnMock = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    let status = 200;
    let responseBody: unknown;
    await handleChat(
      {
        userId,
        body: {
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
    warnMock.mockRestore();

    expect(status).toBe(200);
    expect(responseBody).toEqual({ reply: 'Let us practice.' });
    expect(deepSeekPrompt).toContain(
      'The user is preparing for a frontend interview.',
    );
    expect(deepSeekPrompt).not.toContain('The user prefers pizza.');
  });

  it('does not inject all memories when semantic retrieval fails', async () => {
    const userId = 'retrieval-fallback-test-user';
    memoryStore.saveExtractedMemories(userId, [
      {
        key: 'preference.pet',
        content: 'The user has a cat named Mimi.',
        category: 'preference',
        confidence: 0.95,
      },
    ]);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        if (input.toString() === 'https://embedding.example.com/embeddings') {
          return new Response('Unavailable', { status: 503 });
        }
        const body = JSON.parse(String(init?.body)) as {
          temperature?: number;
          messages?: Array<{ content?: string }>;
        };
        if (body.temperature === 0.8) {
          deepSeekPrompt = body.messages?.[0]?.content ?? '';
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Let us discuss that.' } }],
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
    const warnMock = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await handleChat(
      {
        userId,
        body: { messages: [{ role: 'user', content: 'Tell me about space.' }] },
      },
      {
        status() {
          return this;
        },
        json() {
          return undefined;
        },
      },
    );

    fetchMock.mockRestore();
    warnMock.mockRestore();

    expect(deepSeekPrompt).toContain('No relevant memories');
    expect(deepSeekPrompt).not.toContain('cat named Mimi');
  });

  it('forwards DeepSeek SSE deltas and saves the completed reply', async () => {
    const userId = 'stream-test-user';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        if (input.toString() === 'https://embedding.example.com/embeddings') {
          return new Response(
            JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }),
            { status: 200 },
          );
        }
        const request = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (request.stream) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n',
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
    const writtenEvents: string[] = [];
    let status = 200;
    let ended = false;

    await handleChatStream(
      {
        userId,
        body: {
          messages: [{ role: 'user', content: 'Say hello.' }],
        },
      },
      {
        status(code) {
          status = code;
          return this;
        },
        setHeader() {
          return undefined;
        },
        write(event) {
          writtenEvents.push(event);
          return true;
        },
        end() {
          ended = true;
          return undefined;
        },
      },
    );

    fetchMock.mockRestore();
    infoMock.mockRestore();

    expect(status).toBe(200);
    expect(writtenEvents.map((event) => JSON.parse(event))).toEqual([
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' there' },
      { type: 'complete' },
    ]);
    expect(ended).toBe(true);
  });

  it('saves generated text when the client aborts a stream', async () => {
    const userId = 'cancelled-stream-user';
    const encoder = new TextEncoder();
    let abortRequest: (() => void) | undefined;
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
          ),
        );
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        if (input.toString() === 'https://embedding.example.com/embeddings') {
          return new Response(
            JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }),
            { status: 200 },
          );
        }
        const request = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (!request.stream) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"memories":[]}' } }],
            }),
            { status: 200 },
          );
        }
        const signal = init?.signal;
        signal?.addEventListener('abort', () =>
          streamController?.error(
            new DOMException('Request aborted.', 'AbortError'),
          ),
        );
        return new Response(body as unknown as BodyInit, { status: 200 });
      });
    const writtenEvents: string[] = [];
    let ended = false;

    const stream = handleChatStream(
      {
        userId,
        body: {
          messages: [{ role: 'user', content: 'Start a long reply.' }],
        },
        on(_event, listener) {
          abortRequest = listener;
        },
      },
      {
        status() {
          return this;
        },
        setHeader() {
          return undefined;
        },
        write(event) {
          writtenEvents.push(event);
          if (writtenEvents.length === 1) abortRequest?.();
          return true;
        },
        end() {
          ended = true;
          return undefined;
        },
      },
    );

    await stream;
    fetchMock.mockRestore();

    expect(writtenEvents.map((event) => JSON.parse(event))).toEqual([
      { type: 'delta', text: 'Partial' },
      { type: 'cancelled' },
    ]);
    expect(ended).toBe(true);
    expect(chatStore.listRecentMessages(userId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Partial' }),
      ]),
    );
  });
});

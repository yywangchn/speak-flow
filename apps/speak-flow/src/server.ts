import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteMemory,
  extractMemories,
  findRelevantMemories,
  listMemories,
  saveExtractedMemories,
} from './memory-store';
import {
  MEMORY_EXTRACTION_SYSTEM_PROMPT,
  parseExtractedMemories,
} from './memory-extraction';
import { listRecentMessages, saveChatMessage } from './chat-store';
import { EMBEDDING_MODEL, requestEmbeddings } from './embedding-client';
import {
  currentUser,
  login,
  logout,
  register,
  requireAuth,
  type AuthenticatedRequest,
} from './auth-http';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const MEMORY_RETRIEVAL_OPTIONS = {
  limit: 3,
  minimumSimilarity: 0.35,
} as const;

export const app = express();
let angularApp: AngularNodeAppEngine | undefined;

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatRequest = {
  userId?: string;
  body?: {
    messages?: unknown;
  };
  on?(event: 'aborted', listener: () => void): void;
};

type ChatResponse = {
  json(body: unknown): void;
  status(code: number): ChatResponse;
};

type ChatStreamResponse = {
  status(code: number): ChatStreamResponse;
  setHeader(name: string, value: string): void;
  write(chunk: string): boolean;
  end(): void;
};

const CHAT_SYSTEM_PROMPT =
  'You are SpeakFlow, a warm English conversation partner. Help the user practice natural spoken English. Reply in English in no more than 80 words, gently model better phrasing when useful, and ask exactly one relevant follow-up question. Do not use markdown unless the user asks for it.';

async function extractMemoriesWithAi(
  apiKey: string,
  userId: string,
  text: string,
): Promise<void> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0,
      stream: false,
      messages: [
        {
          role: 'system',
          content: MEMORY_EXTRACTION_SYSTEM_PROMPT,
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Memory extraction failed with ${response.status}`);
  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = result.choices?.[0]?.message?.content?.trim();
  if (!raw) return;
  const memories = parseExtractedMemories(raw);
  if (!memories.length) return;

  const embeddingApiKey = process.env['DASHSCOPE_API_KEY'];
  const embeddingBaseUrl = process.env['DASHSCOPE_BASE_URL'];
  if (!embeddingApiKey || !embeddingBaseUrl) {
    saveExtractedMemories(userId, memories);
    return;
  }

  try {
    const vectors = await requestEmbeddings(
      memories.map(({ content }) => content),
      {
        apiKey: embeddingApiKey,
        baseUrl: embeddingBaseUrl,
        signal: AbortSignal.timeout(15_000),
      },
    );
    saveExtractedMemories(
      userId,
      memories,
      vectors.map((vector) => ({ vector, model: EMBEDDING_MODEL })),
    );
  } catch (error: unknown) {
    // Embedding is an enhancement; text memory must still survive an API failure.
    console.error('Memory embedding failed:', error);
    saveExtractedMemories(userId, memories);
  }
}

app.use(express.json({ limit: '32kb' }));

app.post(
  '/api/auth/register',
  (req, res, next) => void register(req, res).catch(next),
);
app.post(
  '/api/auth/login',
  (req, res, next) => void login(req, res).catch(next),
);
app.post(
  '/api/auth/logout',
  (req, res, next) => void logout(req, res).catch(next),
);
app.get(
  '/api/auth/me',
  (req, res, next) => void currentUser(req, res).catch(next),
);
app.use(
  ['/api/chat', '/api/memories'],
  (req, res, next) =>
    void requireAuth(req as AuthenticatedRequest, res, next).catch(next),
);

app.get('/api/chat/history', (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  res.json({ messages: listRecentMessages(userId) });
});

app.get('/api/memories', (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  res.json(listMemories(userId));
});

app.delete('/api/memories/:id', (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!deleteMemory(userId, req.params['id'])) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }
  res.status(204).send();
});

app.post('/api/chat', (req, res) => void handleChat(req, res));
app.post('/api/chat/stream', (req, res) => void handleChatStream(req, res));

export async function handleChatStream(
  req: ChatRequest,
  res: ChatStreamResponse,
): Promise<void> {
  const apiKey = process.env['DEEPSEEK_API_KEY'];
  const userId = req.userId;
  const messages = getChatMessages(req.body?.messages);
  if (!userId || !messages.length || messages.at(-1)?.role !== 'user') {
    writeStreamEvent(res.status(400), {
      type: 'error',
      message: 'A valid user message is required.',
    });
    return;
  }
  if (!apiKey) {
    writeStreamEvent(res.status(503), {
      type: 'error',
      message: 'DeepSeek API key is not configured.',
    });
    return;
  }

  const latestUserMessage = messages.at(-1)?.content ?? '';
  saveChatMessage(userId, 'user', latestUserMessage);
  const controller = new AbortController();
  let reply = '';
  req.on?.('aborted', () => controller.abort());
  const promptMessages = await buildPromptMessages(
    userId,
    latestUserMessage,
    messages,
  );
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: true,
        temperature: 0.8,
        max_tokens: 180,
        messages: promptMessages,
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const details = await response.text();
      console.error(`DeepSeek stream failed (${response.status}): ${details}`);
      writeStreamEvent(res, {
        type: 'error',
        message: 'DeepSeek could not generate a reply.',
      });
      return;
    }

    for await (const text of readDeepSeekStream(response.body)) {
      reply += text;
      writeStreamEvent(res, { type: 'delta', text });
    }
    if (!reply.trim()) {
      writeStreamEvent(res, {
        type: 'error',
        message: 'DeepSeek returned an empty reply.',
      });
      return;
    }
    saveChatMessage(userId, 'assistant', reply);
    void extractMemoriesWithAi(apiKey, userId, latestUserMessage).catch(
      (error: unknown) => {
        console.error('Memory extraction failed:', error);
        extractMemories(userId, latestUserMessage);
      },
    );
    writeStreamEvent(res, { type: 'complete' });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      if (reply.trim()) saveChatMessage(userId, 'assistant', reply);
      writeStreamEvent(res, { type: 'cancelled' });
      return;
    }
    console.error('DeepSeek stream failed:', error);
    writeStreamEvent(res, {
      type: 'error',
      message: 'Unable to reach DeepSeek.',
    });
  } finally {
    res.end();
  }
}

function getChatMessages(value: unknown): ChatMessage[] {
  return Array.isArray(value)
    ? (value as ChatMessage[])
        .filter(
          (message) =>
            (message?.role === 'user' || message?.role === 'assistant') &&
            typeof message.content === 'string' &&
            message.content.trim().length > 0,
        )
        .slice(-20)
        .map((message) => ({
          role: message.role,
          content: message.content.trim().slice(0, 4000),
        }))
    : [];
}

async function buildPromptMessages(
  userId: string,
  latestUserMessage: string,
  messages: readonly ChatMessage[],
): Promise<Array<{ role: 'system' | ChatMessage['role']; content: string }>> {
  let memories = listMemories(userId);
  const storedMemoryCount = memories.length;
  const embeddingApiKey = process.env['DASHSCOPE_API_KEY'];
  const embeddingBaseUrl = process.env['DASHSCOPE_BASE_URL'];
  if (embeddingApiKey && embeddingBaseUrl) {
    try {
      const [queryVector] = await requestEmbeddings([latestUserMessage], {
        apiKey: embeddingApiKey,
        baseUrl: embeddingBaseUrl,
        signal: AbortSignal.timeout(15_000),
      });
      if (queryVector) {
        const relevantMemories = findRelevantMemories(
          userId,
          queryVector,
          MEMORY_RETRIEVAL_OPTIONS,
        );
        memories = relevantMemories;
        console.info('Memory retrieval completed', {
          userId,
          storedMemoryCount,
          returnedCount: relevantMemories.length,
          model: EMBEDDING_MODEL,
          ...MEMORY_RETRIEVAL_OPTIONS,
          similarities: relevantMemories.map(({ similarity }) =>
            Number(similarity.toFixed(3)),
          ),
        });
      } else {
        console.warn('Memory retrieval fallback', {
          userId,
          reason: 'Embedding service returned no query vector.',
        });
      }
    } catch (error: unknown) {
      console.warn('Memory retrieval fallback', {
        userId,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } else {
    console.info('Memory retrieval skipped', {
      userId,
      reason: 'Embedding API is not configured.',
    });
  }
  const memoryContext = memories.length
    ? `Known things about the user:\n${memories.map(({ content }) => `- ${content}`).join('\n')}`
    : 'No saved memories about the user yet.';
  return [
    { role: 'system', content: `${CHAT_SYSTEM_PROMPT}\n\n${memoryContext}` },
    ...messages,
  ];
}

function writeStreamEvent(
  response: Pick<ChatStreamResponse, 'write' | 'end'>,
  event: import('@speak-flow/chat-models').ChatStreamEvent,
): void {
  response.write(`${JSON.stringify(event)}\n`);
  if (event.type === 'error') response.end();
}

async function* readDeepSeekStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.trim().replace(/^data:\s*/, '');
        if (!data || data === '[DONE]') continue;
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function handleChat(
  req: ChatRequest,
  res: ChatResponse,
): Promise<void> {
  const apiKey = process.env['DEEPSEEK_API_KEY'];
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const messages = getChatMessages(req.body?.messages);

  if (!messages.length || messages.at(-1)?.role !== 'user') {
    res.status(400).json({ error: 'A user message is required.' });
    return;
  }

  try {
    const latestUserMessage = messages.at(-1)?.content ?? '';
    saveChatMessage(userId, 'user', latestUserMessage);
    if (!apiKey) {
      res.status(503).json({ error: 'DeepSeek API key is not configured.' });
      return;
    }
    const promptMessages = await buildPromptMessages(
      userId,
      latestUserMessage,
      messages,
    );
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        stream: false,
        temperature: 0.8,
        max_tokens: 180,
        messages: promptMessages,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error(`DeepSeek request failed (${response.status}): ${details}`);
      res.status(502).json({ error: 'DeepSeek could not generate a reply.' });
      return;
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = result.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      res.status(502).json({ error: 'DeepSeek returned an empty reply.' });
      return;
    }

    saveChatMessage(userId, 'assistant', reply);
    void extractMemoriesWithAi(apiKey, userId, latestUserMessage).catch(
      (error: unknown) => {
        console.error('Memory extraction failed:', error);
        extractMemories(userId, latestUserMessage);
      },
    );
    res.json({ reply });
  } catch (error) {
    console.error('DeepSeek request failed:', error);
    res.status(502).json({ error: 'Unable to reach DeepSeek.' });
  }
}

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/**', (req, res, next) => {
  const engine = (angularApp ??= new AngularNodeAppEngine());
  engine
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);

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

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const MEMORY_RETRIEVAL_OPTIONS = {
  limit: 3,
  minimumSimilarity: 0.35,
} as const;

const app = express();
const angularApp = new AngularNodeAppEngine();

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const getUserId = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value)
    ? value
    : null;

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

app.get('/api/chat/history', (req, res) => {
  const userId = getUserId(req.query['userId']);
  if (!userId) {
    res.status(400).json({ error: 'A valid userId is required.' });
    return;
  }
  res.json({ messages: listRecentMessages(userId) });
});

app.get('/api/memories', (req, res) => {
  const userId = getUserId(req.query['userId']);
  if (!userId) {
    res.status(400).json({ error: 'A valid userId is required.' });
    return;
  }
  res.json(listMemories(userId));
});

app.delete('/api/memories/:id', (req, res) => {
  const userId = getUserId(req.query['userId']);
  if (!userId) {
    res.status(400).json({ error: 'A valid userId is required.' });
    return;
  }
  if (!deleteMemory(userId, req.params['id'])) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }
  res.status(204).send();
});

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env['DEEPSEEK_API_KEY'];
  const userId = getUserId(req.body?.userId);
  if (!userId) {
    res.status(400).json({ error: 'A valid userId is required.' });
    return;
  }

  const messages = Array.isArray(req.body?.messages)
    ? (req.body.messages as ChatMessage[])
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
        messages: [
          {
            role: 'system',
            content: `You are SpeakFlow, a warm English conversation partner. Help the user practice natural spoken English. Reply in English in no more than 80 words, gently model better phrasing when useful, and ask exactly one relevant follow-up question. Do not use markdown unless the user asks for it.\n\n${memoryContext}`,
          },
          ...messages,
        ],
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
});

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
  angularApp
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

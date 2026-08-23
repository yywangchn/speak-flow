import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import Busboy from 'busboy';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExtractedMemories } from './memory-extraction';
import {
  listRecentMessages,
  saveChatMessage,
} from './database/chat-persistence';
import {
  deleteMemory,
  extractMemories,
  findRelevantMemories,
  listMemories,
  saveExtractedMemories,
} from './database/memory-persistence';
import { EMBEDDING_MODEL, requestEmbeddings } from './embedding-client';
import { AI_SETTINGS } from './ai-settings';
import {
  currentUser,
  login,
  logout,
  register,
  requireAuth,
  type AuthenticatedRequest,
} from './auth-http';
import { streamSpeech, synthesizeSpeech } from './cosyvoice-client';
import {
  createStudyMaterial,
  getStudyMaterial,
  listStudyMaterials,
  saveStudySegments,
  updateStudyMaterialStatus,
  updateStudySegmentAudio,
  addStudyVocabulary,
  deleteStudyVocabulary,
  listStudyVocabulary,
} from './study-store';
import { detectSubtitleFormat, parseSubtitle } from './study-subtitles';
import { cutAudioSegment } from './study-audio';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const MEMORY_RETRIEVAL_OPTIONS = {
  limit: AI_SETTINGS.memoryRetrieval.topK,
  minimumSimilarity: AI_SETTINGS.memoryRetrieval.minimumSimilarity,
} as const;
const PRIVATE_MEMORY_COOLDOWN_MS = 30 * 60 * 1000;
const privateMemoryLastUsedAt = new Map<string, number>();

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

export function handleHealth(_req: unknown, res: ChatResponse): void {
  res.json({ status: 'ok' });
}

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
      model: AI_SETTINGS.memoryExtraction.model,
      temperature: AI_SETTINGS.memoryExtraction.temperature,
      stream: false,
      messages: [
        {
          role: 'system',
          content: AI_SETTINGS.memoryExtraction.systemPrompt,
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
    await saveExtractedMemories(userId, memories);
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
    await saveExtractedMemories(
      userId,
      memories,
      vectors.map((vector) => ({ vector, model: EMBEDDING_MODEL })),
    );
  } catch (error: unknown) {
    // Embedding is an enhancement; text memory must still survive an API failure.
    console.error('Memory embedding failed:', error);
    await saveExtractedMemories(userId, memories);
  }
}

app.use(express.json({ limit: '32kb' }));

app.get('/api/health', handleHealth);

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
  ['/api/chat', '/api/memories', '/api/speech', '/api/study'],
  (req, res, next) =>
    void requireAuth(req as AuthenticatedRequest, res, next).catch(next),
);

const asyncRoute =
  (
    handler: (
      req: AuthenticatedRequest,
      res: Parameters<RequestHandler>[1],
    ) => Promise<void>,
  ): RequestHandler =>
  (req, res, next) =>
    void handler(req as AuthenticatedRequest, res).catch(next);

app.get(
  '/api/chat/history',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.json({ messages: await listRecentMessages(userId) });
  }),
);

app.get(
  '/api/study/materials',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.json({ materials: listStudyMaterials(userId) });
  }),
);

app.get(
  '/api/study/vocabulary',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.json({ vocabulary: listStudyVocabulary(userId) });
  }),
);

app.post(
  '/api/study/vocabulary',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const body = req.body as {
      word?: unknown;
      sourceText?: unknown;
      materialId?: unknown;
      segmentId?: unknown;
    };
    if (
      !userId ||
      typeof body.word !== 'string' ||
      typeof body.sourceText !== 'string'
    ) {
      res.status(400).json({ error: 'Word and source text are required.' });
      return;
    }
    const word = body.word.trim().toLowerCase();
    res.status(201).json({
      vocabulary: addStudyVocabulary({
        userId,
        word,
        sourceText: body.sourceText,
        materialId:
          typeof body.materialId === 'string' ? body.materialId : undefined,
        segmentId:
          typeof body.segmentId === 'string' ? body.segmentId : undefined,
        dictionaryUrl: `https://www.ldoceonline.com/dictionary/${encodeURIComponent(word)}`,
      }),
    });
  }),
);

app.delete(
  '/api/study/vocabulary/:id',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId || !deleteStudyVocabulary(userId, req.params['id'])) {
      res.status(404).json({ error: 'Vocabulary item not found.' });
      return;
    }
    res.status(204).send();
  }),
);

app.post(
  '/api/study/materials',
  (req, res, next) =>
    void handleStudyUpload(req as AuthenticatedRequest, res).catch(next),
);

app.get(
  '/api/study/materials/:id',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const material = getStudyMaterial(userId, req.params['id']);
    if (!material) {
      res.status(404).json({ error: 'Study material not found.' });
      return;
    }
    res.json(material);
  }),
);

app.get(
  '/api/study/materials/:id/audio',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const material = getStudyMaterial(userId, req.params['id']);
    if (!material) {
      res.status(404).json({ error: 'Study material not found.' });
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    createReadStream(material.material.audioPath)
      .on('error', () => {
        if (!res.headersSent)
          res.status(404).json({ error: 'Audio file not found.' });
      })
      .pipe(res);
  }),
);

app.get(
  '/api/study/materials/:id/segments/:segmentId/audio',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const study = getStudyMaterial(userId, req.params['id']);
    const segment = study?.segments.find(
      ({ id }) => id === req.params['segmentId'],
    );
    if (!segment?.audioPath) {
      res.status(404).json({ error: 'Study segment audio not found.' });
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    createReadStream(segment.audioPath).pipe(res);
  }),
);

app.get(
  '/api/memories',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.json(await listMemories(userId));
  }),
);

app.delete(
  '/api/memories/:id',
  asyncRoute(async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!(await deleteMemory(userId, req.params['id']))) {
      res.status(404).json({ error: 'Memory not found.' });
      return;
    }
    res.status(204).send();
  }),
);

app.post(
  '/api/chat',
  (req, res, next) => void handleChat(req, res).catch(next),
);
app.post(
  '/api/chat/stream',
  (req, res, next) => void handleChatStream(req, res).catch(next),
);
app.post(
  '/api/speech',
  (req, res, next) => void handleSpeech(req, res).catch(next),
);
app.post(
  '/api/speech/stream',
  (req, res, next) => void handleSpeechAudioStream(req, res).catch(next),
);

export async function handleSpeech(
  req: AuthenticatedRequest,
  res: Response,
  synthesize: typeof synthesizeSpeech = synthesizeSpeech,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 2000) {
    res.status(400).json({ error: 'Text must contain 1 to 2000 characters.' });
    return;
  }
  const apiKey = process.env['DASHSCOPE_API_KEY'];
  if (!apiKey) {
    res.status(503).json({ error: 'CosyVoice API key is not configured.' });
    return;
  }

  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  try {
    const audio = await synthesize({
      apiKey,
      text,
      signal: controller.signal,
      ...(process.env['COSYVOICE_MODEL']
        ? { model: process.env['COSYVOICE_MODEL'] }
        : {}),
      ...(process.env['COSYVOICE_VOICE']
        ? { voice: process.env['COSYVOICE_VOICE'] }
        : {}),
    });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(audio);
  } catch (error: unknown) {
    if (controller.signal.aborted) return;
    console.error('CosyVoice request failed:', error);
    res.status(502).json({ error: 'Speech could not be generated.' });
  }
}

async function handleStudyUpload(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!String(req.headers['content-type']).includes('multipart/form-data')) {
    res.status(415).json({
      error:
        'Audio and subtitle files must be uploaded as multipart form data.',
    });
    return;
  }
  const busboy = Busboy({
    headers: req.headers,
    limits: { files: 2, fileSize: 200 * 1024 * 1024 },
  });
  const uploadId = randomUUID();
  const directory = join(
    process.env['SPEAKFLOW_DATA_DIRECTORY'] ?? 'data',
    'study-media',
    uploadId,
  );
  mkdirSync(directory, { recursive: true });
  let audioPath = '';
  let subtitlePath = '';
  let audioName = '';
  let subtitleName = '';
  const writes: Promise<void>[] = [];
  busboy.on('file', (field, stream, info) => {
    const target =
      field === 'audio' ? 'audio' : field === 'subtitle' ? 'subtitle' : null;
    if (!target) {
      stream.resume();
      return;
    }
    const safeName = info.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = join(directory, `${target}-${safeName}`);
    if (target === 'audio') {
      audioPath = path;
      audioName = safeName;
    } else {
      subtitlePath = path;
      subtitleName = safeName;
    }
    writes.push(
      new Promise<void>((resolveWrite, reject) => {
        const output = createWriteStream(path);
        output.on('finish', resolveWrite);
        output.on('error', reject);
        stream.on('error', reject).pipe(output);
      }),
    );
  });
  await new Promise<void>((resolveUpload, rejectUpload) => {
    busboy.on('finish', () => resolveUpload());
    busboy.on('error', rejectUpload);
    req.pipe(busboy);
  });
  await Promise.all(writes);
  if (!audioPath || !subtitlePath) {
    res
      .status(400)
      .json({ error: 'Both audio and subtitle files are required.' });
    return;
  }
  const format = detectSubtitleFormat(subtitleName);
  const material = createStudyMaterial({
    userId: req.userId,
    title: audioName,
    audioPath,
    subtitlePath,
    subtitleFormat: format,
  });
  if (format !== 'plain-text') {
    saveStudySegments(
      material.id,
      parseSubtitle(readFileSync(subtitlePath, 'utf8'), format),
    );
    const stored = getStudyMaterial(req.userId, material.id);
    try {
      const segmentDirectory = join(directory, 'segments');
      mkdirSync(segmentDirectory, { recursive: true });
      for (const segment of stored?.segments ?? []) {
        const outputPath = join(
          segmentDirectory,
          `${String(segment.index).padStart(4, '0')}.mp3`,
        );
        await cutAudioSegment(
          audioPath,
          outputPath,
          segment.startSeconds,
          segment.endSeconds,
        );
        updateStudySegmentAudio(segment.id, outputPath);
      }
      updateStudyMaterialStatus(material.id, 'ready');
    } catch (error: unknown) {
      updateStudyMaterialStatus(
        material.id,
        'failed',
        error instanceof Error ? error.message : 'Audio cutting failed.',
      );
    }
  } else {
    updateStudyMaterialStatus(
      material.id,
      'failed',
      'Plain text requires a local forced-alignment command. Configure SPEAKFLOW_ALIGN_COMMAND before processing.',
    );
  }
  res.status(201).json({ material: getStudyMaterial(req.userId, material.id) });
}

type SpeechStreamResponse = Pick<Response, 'end' | 'setHeader' | 'status'> & {
  json(body: unknown): void;
  write(chunk: Buffer): boolean;
};

export async function handleSpeechAudioStream(
  req: AuthenticatedRequest,
  res: SpeechStreamResponse,
  stream: typeof streamSpeech = streamSpeech,
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 2000) {
    res.status(400).json({ error: 'Text must contain 1 to 2000 characters.' });
    return;
  }
  const apiKey = process.env['DASHSCOPE_API_KEY'];
  if (!apiKey) {
    res.status(503).json({ error: 'CosyVoice API key is not configured.' });
    return;
  }

  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  let started = false;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  try {
    await stream(
      {
        apiKey,
        text,
        signal: controller.signal,
        ...(process.env['COSYVOICE_MODEL']
          ? { model: process.env['COSYVOICE_MODEL'] }
          : {}),
        ...(process.env['COSYVOICE_VOICE']
          ? { voice: process.env['COSYVOICE_VOICE'] }
          : {}),
      },
      (chunk) => {
        started = true;
        res.write(chunk);
      },
    );
    res.end();
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      res.end();
      return;
    }
    console.error('CosyVoice stream failed:', error);
    if (started) {
      res.end();
      return;
    }
    res.status(502).json({ error: 'Speech could not be generated.' });
  }
}

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
  const previousMessages = await listRecentMessages(userId, 2);
  const previousMessage = previousMessages.at(-1);
  await saveChatMessage(userId, 'user', latestUserMessage);
  const controller = new AbortController();
  let reply = '';
  req.on?.('aborted', () => controller.abort());
  const promptMessages = await buildPromptMessages(
    userId,
    latestUserMessage,
    messages,
    previousMessage?.createdAt,
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
        model: AI_SETTINGS.chat.model,
        stream: true,
        temperature: AI_SETTINGS.chat.temperature,
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
    await saveChatMessage(userId, 'assistant', reply);
    void extractMemoriesWithAi(apiKey, userId, latestUserMessage).catch(
      (error: unknown) => {
        console.error('Memory extraction failed:', error);
        void extractMemories(userId, latestUserMessage).catch(console.error);
      },
    );
    writeStreamEvent(res, { type: 'complete' });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      if (reply.trim()) await saveChatMessage(userId, 'assistant', reply);
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
  previousMessageAt?: string,
): Promise<Array<{ role: 'system' | ChatMessage['role']; content: string }>> {
  const storedMemoryCount = (await listMemories(userId)).length;
  let memories: Awaited<ReturnType<typeof listMemories>> = [];
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
        const relevantMemories = await findRelevantMemories(
          userId,
          queryVector,
          MEMORY_RETRIEVAL_OPTIONS,
        );
        memories = relevantMemories
          .filter((memory) =>
            isMemoryExplicitlyAllowed(memory, latestUserMessage),
          )
          .filter((memory) => {
            if (!isPrivateMemory(memory)) return true;
            const lastUsedAt = privateMemoryLastUsedAt.get(memory.id);
            return (
              !lastUsedAt ||
              Date.now() - lastUsedAt >= PRIVATE_MEMORY_COOLDOWN_MS ||
              isExplicitPrivateTopic(latestUserMessage)
            );
          });
        for (const memory of memories) {
          if (isPrivateMemory(memory))
            privateMemoryLastUsedAt.set(memory.id, Date.now());
        }
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
    ? `Optional background memory:\n${memories.map(({ content }) => `- ${content}`).join('\n')}\nUse it only when the user's latest message clearly concerns this topic or explicitly asks about it. Never introduce the memory topic yourself, never mention it to demonstrate familiarity, and never force it into an unrelated reply. If the topic is not directly relevant, ignore this memory completely.`
    : 'No relevant memories are available for this message.';
  const currentTime = new Date();
  const previousTime = previousMessageAt ? new Date(previousMessageAt) : null;
  const gapMinutes =
    previousTime && !Number.isNaN(previousTime.getTime())
      ? Math.max(
          0,
          Math.round((currentTime.getTime() - previousTime.getTime()) / 60000),
        )
      : null;
  const timeContext = `Current local server time (ISO 8601): ${currentTime.toISOString()}.${
    gapMinutes === null
      ? ' There is no earlier saved message available for calculating a conversation gap.'
      : ` The previous saved message was at ${previousTime?.toISOString()}, approximately ${gapMinutes} minutes ago.`
  } Use this context only to make a natural greeting or check-in when it genuinely fits.`;
  const conversationMessages = messages.filter(
    (message) =>
      message.role === 'user' ||
      !privateTopicPatterns.pet.test(message.content) ||
      privateTopicPatterns.pet.test(latestUserMessage),
  );
  return [
    {
      role: 'system',
      content: `${AI_SETTINGS.chat.systemPrompt}\n\n${timeContext}\n\n${memoryContext}\nNever continue an assistant-introduced topic merely because it appeared in recent chat. Follow the user's latest message; if it does not concern a private topic, choose a neutral topic instead.`,
    },
    ...conversationMessages,
  ];
}

const privateTopicPatterns = {
  pet: /\b(cat|cats|kitten|dog|dogs|pet|pets|animal|animals)\b/i,
  relationship: /\b(boyfriend|girlfriend|partner|husband|wife)\b/i,
  family: /\b(family|parents?|mother|father|child|children|son|daughter)\b/i,
  location: /\b(home|hometown|city|town|live|lives|living)\b/i,
} as const;

function isMemoryExplicitlyAllowed(
  memory: { readonly key?: string; readonly content: string },
  latestUserMessage: string,
): boolean {
  const key = memory.key ?? '';
  const topic = (
    Object.keys(privateTopicPatterns) as Array<
      keyof typeof privateTopicPatterns
    >
  ).find(
    (candidate) =>
      new RegExp(candidate === 'pet' ? 'pet|animal' : candidate, 'i').test(
        key,
      ) || privateTopicPatterns[candidate].test(memory.content),
  );
  return !topic || privateTopicPatterns[topic].test(latestUserMessage);
}

function isPrivateMemory(memory: {
  readonly key?: string;
  readonly content: string;
}): boolean {
  const value = `${memory.key ?? ''} ${memory.content}`;
  return /\b(pet|animal|relationship|partner|family|parent|child|location|cat|dog|kitten)\b/i.test(
    value,
  );
}

function isExplicitPrivateTopic(message: string): boolean {
  return Object.values(privateTopicPatterns).some((pattern) =>
    pattern.test(message),
  );
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
    await saveChatMessage(userId, 'user', latestUserMessage);
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
        model: AI_SETTINGS.chat.model,
        stream: false,
        temperature: AI_SETTINGS.chat.temperature,
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

    await saveChatMessage(userId, 'assistant', reply);
    void extractMemoriesWithAi(apiKey, userId, latestUserMessage).catch(
      (error: unknown) => {
        console.error('Memory extraction failed:', error);
        void extractMemories(userId, latestUserMessage).catch(console.error);
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

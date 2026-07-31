import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

app.use(express.json({ limit: '32kb' }));

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env['DEEPSEEK_API_KEY'];
  if (!apiKey) {
    res.status(503).json({ error: 'DeepSeek API key is not configured.' });
    return;
  }

  const messages = Array.isArray(req.body?.messages)
    ? (req.body.messages as ChatMessage[])
        .filter(
          (message) =>
            (message?.role === 'user' || message?.role === 'assistant') &&
            typeof message.content === 'string' &&
            message.content.trim().length > 0
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
            content:
              'You are SpeakFlow, a warm English conversation partner. Help the user practice natural spoken English. Reply in English in no more than 80 words, gently model better phrasing when useful, and ask exactly one relevant follow-up question. Do not use markdown unless the user asks for it.',
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
  })
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next()
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

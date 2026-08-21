import { randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';

const DEFAULT_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';
const DEFAULT_MODEL = 'qwen3-tts-vc-2026-01-22';
const DEFAULT_VOICE = 'qwen-tts-vc-bailian-voice-20260821173838226-a6cc';

type DashScopeEvent = {
  readonly header?: {
    readonly event?: string;
    readonly error_code?: string;
    readonly error_message?: string;
  };
};

export type CosyVoiceOptions = {
  readonly apiKey: string;
  readonly text: string;
  readonly signal?: AbortSignal;
  readonly endpoint?: string;
  readonly model?: string;
  readonly voice?: string;
};

export async function synthesizeSpeech(
  options: CosyVoiceOptions,
): Promise<Buffer> {
  if (isQwenTtsModel(options.model ?? DEFAULT_MODEL)) {
    return synthesizeQwenSpeech(options);
  }
  const audioChunks: Buffer[] = [];
  await streamSpeech(options, (chunk) => audioChunks.push(chunk));
  return Buffer.concat(audioChunks);
}

export async function streamSpeech(
  options: CosyVoiceOptions,
  onAudioChunk: (chunk: Buffer) => void,
): Promise<void> {
  if (isQwenTtsModel(options.model ?? DEFAULT_MODEL)) {
    onAudioChunk(await synthesizeQwenSpeech(options));
    return;
  }
  const taskId = randomUUID().replace(/-/g, '');
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;
  const voice = options.voice ?? DEFAULT_VOICE;

  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });
    let receivedAudio = false;
    let settled = false;
    const timeout = setTimeout(() => {
      socket.terminate();
      finish(new Error('CosyVoice request timed out.'));
    }, 45_000);

    const onAbort = (): void => {
      socket.terminate();
      finish(new DOMException('Speech synthesis was cancelled.', 'AbortError'));
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      if (error) {
        reject(error);
        return;
      }
      if (!receivedAudio) {
        reject(new Error('CosyVoice returned no audio.'));
        return;
      }
      resolve();
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          header: {
            action: 'run-task',
            task_id: taskId,
            streaming: 'duplex',
          },
          payload: {
            task_group: 'audio',
            task: 'tts',
            function: 'SpeechSynthesizer',
            model,
            parameters: {
              text_type: 'PlainText',
              voice,
              format: 'mp3',
              sample_rate: 22_050,
              volume: 50,
              rate: 1,
              pitch: 1,
            },
            input: {},
          },
        }),
      );
    });
    socket.on('message', (data: RawData, isBinary: boolean) => {
      try {
        if (isBinary) {
          receivedAudio = true;
          onAudioChunk(toBuffer(data));
          return;
        }

        const event = parseEvent(data.toString());
        if (event.header?.event === 'task-started') {
          socket.send(
            JSON.stringify({
              header: { action: 'continue-task', task_id: taskId },
              payload: { input: { text: options.text } },
            }),
          );
          socket.send(
            JSON.stringify({
              header: { action: 'finish-task', task_id: taskId },
              payload: { input: {} },
            }),
          );
        }
        if (event.header?.event === 'task-finished') finish();
        if (event.header?.event === 'task-failed') {
          finish(
            new Error(
              `CosyVoice failed: ${event.header.error_code ?? 'UNKNOWN'} ${event.header.error_message ?? ''}`.trim(),
            ),
          );
        }
      } catch (error: unknown) {
        finish(
          error instanceof Error
            ? error
            : new Error('CosyVoice response could not be processed.'),
        );
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (!settled) finish(new Error('CosyVoice closed before completion.'));
    });
  });
}

type QwenTtsResponse = {
  readonly output?: { readonly audio?: { readonly url?: string } };
  readonly code?: string;
  readonly message?: string;
};

function isQwenTtsModel(model: string): boolean {
  return model.startsWith('qwen3-tts-') || model.startsWith('qwen-tts');
}

async function synthesizeQwenSpeech(
  options: CosyVoiceOptions,
): Promise<Buffer> {
  const model = options.model ?? DEFAULT_MODEL;
  const voice = options.voice ?? DEFAULT_VOICE;
  const response = await fetch(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: { text: options.text, voice, language_type: 'English' },
      }),
      signal: options.signal,
    },
  );
  const result = (await response.json()) as QwenTtsResponse;
  const audioUrl = result.output?.audio?.url;
  if (!response.ok || !audioUrl) {
    throw new Error(
      `Qwen TTS failed: ${result.code ?? response.status} ${result.message ?? 'No audio URL returned.'}`,
    );
  }

  const audioResponse = await fetch(audioUrl, { signal: options.signal });
  if (!audioResponse.ok) {
    throw new Error(`Qwen TTS audio download failed: ${audioResponse.status}`);
  }
  return Buffer.from(await audioResponse.arrayBuffer());
}

function parseEvent(value: string): DashScopeEvent {
  try {
    return JSON.parse(value) as DashScopeEvent;
  } catch {
    throw new Error('CosyVoice returned an invalid response.');
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  throw new Error('CosyVoice returned an unsupported binary payload.');
}

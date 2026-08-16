import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';

const DEFAULT_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';
const DEFAULT_MODEL = 'cosyvoice-v3-flash';
const DEFAULT_VOICES = ['loongluca_v3'] as const;
const TEST_TEXT =
  "It's great to hear from you. What is something you're looking forward to this week?";
const OUTPUT_DIRECTORY = join(process.cwd(), 'tmp', 'cosyvoice-spike');

type CosyVoiceResult = {
  readonly voice: string;
  readonly outputPath: string;
  readonly audioBytes: number;
  readonly characters: number;
  readonly firstAudioLatencyMs: number;
  readonly totalLatencyMs: number;
  readonly estimatedCostCny: number;
};

type DashScopeEvent = {
  readonly header?: {
    readonly event?: string;
    readonly error_code?: string;
    readonly error_message?: string;
  };
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const apiKey = getRequiredEnvironmentVariable('DASHSCOPE_API_KEY');
  const endpoint = process.env['COSYVOICE_WEBSOCKET_URL'] ?? DEFAULT_ENDPOINT;
  const model = process.env['COSYVOICE_MODEL'] ?? DEFAULT_MODEL;
  const voices = readVoices(process.env['COSYVOICE_VOICES']);
  const pricePerTenThousandCharacters = readPrice(
    process.env['COSYVOICE_PRICE_PER_10K_CHARS'] ?? '2',
  );

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  console.log(`Model: ${model}`);
  console.log(`Text (${countCharacters(TEST_TEXT)} characters): ${TEST_TEXT}`);
  console.log(
    `Cost assumption: CNY ${pricePerTenThousandCharacters} per 10,000 characters`,
  );

  const results: CosyVoiceResult[] = [];
  for (const voice of voices) {
    console.log(`\nGenerating ${voice}...`);
    const result = await synthesize({
      apiKey,
      endpoint,
      model,
      voice,
      text: TEST_TEXT,
      pricePerTenThousandCharacters,
    });
    results.push(result);
    console.log(
      `Saved ${result.outputPath} (${result.audioBytes} bytes, first audio ${result.firstAudioLatencyMs}ms, total ${result.totalLatencyMs}ms)`,
    );
  }

  console.log('\nComparison');
  console.table(
    results.map((result) => ({
      voice: result.voice,
      characters: result.characters,
      firstAudioMs: result.firstAudioLatencyMs,
      totalMs: result.totalLatencyMs,
      audioBytes: result.audioBytes,
      estimatedCostCny: result.estimatedCostCny.toFixed(6),
      file: result.outputPath,
    })),
  );
  console.log(
    `Estimated total: CNY ${results.reduce((total, result) => total + result.estimatedCostCny, 0).toFixed(6)}`,
  );
  console.log('Listen to the generated files before choosing a voice.');
}

async function synthesize(options: {
  apiKey: string;
  endpoint: string;
  model: string;
  voice: string;
  text: string;
  pricePerTenThousandCharacters: number;
}): Promise<CosyVoiceResult> {
  const taskId = randomUUID().replace(/-/g, '');
  const startedAt = performance.now();
  const audioChunks: Buffer[] = [];
  let firstAudioLatencyMs: number | undefined;

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(options.endpoint, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`CosyVoice timed out for voice ${options.voice}.`));
    }, 45_000);
    let finished = false;

    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.close();
      error ? reject(error) : resolve();
    };

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
            model: options.model,
            parameters: {
              text_type: 'PlainText',
              voice: options.voice,
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
      if (isBinary) {
        firstAudioLatencyMs ??= Math.round(performance.now() - startedAt);
        audioChunks.push(toBuffer(data));
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
            `CosyVoice failed for ${options.voice}: ${event.header.error_code ?? 'UNKNOWN'} ${event.header.error_message ?? ''}`.trim(),
          ),
        );
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('close', () => {
      if (!finished)
        finish(new Error(`CosyVoice closed before ${options.voice} finished.`));
    });
  });

  if (!audioChunks.length || firstAudioLatencyMs === undefined)
    throw new Error(`CosyVoice returned no audio for ${options.voice}.`);

  const audio = Buffer.concat(audioChunks);
  const outputPath = join(
    OUTPUT_DIRECTORY,
    `${sanitizeFileName(options.model)}-${sanitizeFileName(options.voice)}.mp3`,
  );
  await writeFile(outputPath, audio);
  const characters = countCharacters(options.text);
  return {
    voice: options.voice,
    outputPath,
    audioBytes: audio.byteLength,
    characters,
    firstAudioLatencyMs,
    totalLatencyMs: Math.round(performance.now() - startedAt),
    estimatedCostCny:
      (characters / 10_000) * options.pricePerTenThousandCharacters,
  };
}

function parseEvent(value: string): DashScopeEvent {
  try {
    return JSON.parse(value) as DashScopeEvent;
  } catch {
    throw new Error(`CosyVoice returned invalid JSON: ${value.slice(0, 200)}`);
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  throw new Error('CosyVoice returned an unsupported binary payload.');
}

function readVoices(value: string | undefined): string[] {
  const voices = (value ?? DEFAULT_VOICES.join(','))
    .split(',')
    .map((voice) => voice.trim())
    .filter(Boolean);
  if (voices.length === 0)
    throw new Error('COSYVOICE_VOICES must contain at least one voice ID.');
  return voices;
}

function readPrice(value: string): number {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0)
    throw new Error(
      'COSYVOICE_PRICE_PER_10K_CHARS must be a non-negative number.',
    );
  return price;
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, '-');
}

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

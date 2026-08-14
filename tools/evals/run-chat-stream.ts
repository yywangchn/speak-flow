import dataset from './chat-stream.dataset.json';
import { AI_SETTINGS } from '../../apps/speak-flow/src/ai-settings';

type StreamCase = {
  id: string;
  input: string;
  cancelAfterFirstToken?: boolean;
};

type StreamResult = {
  id: string;
  success: boolean;
  cancelled: boolean;
  firstTokenLatencyMs?: number;
  totalLatencyMs: number;
  wordCount: number;
  questionCount: number;
  error?: string;
};

const apiKey = process.env['DEEPSEEK_API_KEY'];
if (!apiKey)
  throw new Error('DEEPSEEK_API_KEY is required to run stream evaluation.');

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  console.log(
    `AI settings: ${AI_SETTINGS.version} (${AI_SETTINGS.chat.version})`,
  );
  const cases = dataset as StreamCase[];
  const results: StreamResult[] = [];
  for (const testCase of cases) {
    const result = await evaluateStream(testCase);
    results.push(result);
    console.log(
      `${result.success ? 'PASS' : 'FAIL'} ${result.id} ttft=${formatLatency(result.firstTokenLatencyMs)} total=${result.totalLatencyMs}ms${result.cancelled ? ' cancelled' : ''}${result.error ? ` error=${result.error}` : ''}`,
    );
  }

  const cancellationCaseIds = new Set(
    cases
      .filter(({ cancelAfterFirstToken }) => cancelAfterFirstToken)
      .map(({ id }) => id),
  );
  const expectedCompletions = results.filter(
    ({ id }) => !cancellationCaseIds.has(id),
  );
  const completed = expectedCompletions.filter(({ success }) => success);
  const cancellationCases = results.filter(({ id }) =>
    cancellationCaseIds.has(id),
  );
  const firstTokenLatencies = completed.flatMap((result) =>
    result.firstTokenLatencyMs === undefined
      ? []
      : [result.firstTokenLatencyMs],
  );

  console.log('\nStreaming evaluation');
  console.log(`Requests: ${results.length}`);
  console.log(
    `Failure rate: ${percentage(1 - ratio(completed.length, expectedCompletions.length))}`,
  );
  console.log(
    `Cancellation success: ${percentage(ratio(cancellationCases.filter((result) => result.success && result.cancelled).length, cancellationCases.length))}`,
  );
  console.log(`Average TTFT: ${formatLatency(average(firstTokenLatencies))}`);
  console.log(
    `P95 TTFT: ${formatLatency(percentile(firstTokenLatencies, 0.95))}`,
  );
  console.log(
    `Average total latency: ${formatLatency(average(completed.map(({ totalLatencyMs }) => totalLatencyMs)))}`,
  );
  console.log(
    `Reply constraints: ${percentage(ratio(completed.filter(({ wordCount, questionCount }) => wordCount <= 80 && questionCount === 1).length, completed.length))}`,
  );

  if (results.some((result) => !result.success)) process.exitCode = 1;
}

async function evaluateStream(testCase: StreamCase): Promise<StreamResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
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
        messages: [
          { role: 'system', content: AI_SETTINGS.chat.systemPrompt },
          { role: 'user', content: testCase.input },
        ],
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok || !response.body) {
      throw new Error(`DeepSeek returned ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reply = '';
    let firstTokenLatencyMs: number | undefined;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const text = readDelta(line);
          if (!text) continue;
          firstTokenLatencyMs ??= Math.round(performance.now() - startedAt);
          reply += text;
          if (testCase.cancelAfterFirstToken) {
            controller.abort();
            await reader.cancel().catch((error: unknown) => {
              if (
                !(error instanceof DOMException && error.name === 'AbortError')
              )
                throw error;
            });
            return createResult(
              testCase.id,
              startedAt,
              reply,
              true,
              true,
              firstTokenLatencyMs,
            );
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return createResult(
      testCase.id,
      startedAt,
      reply,
      reply.length > 0,
      false,
      firstTokenLatencyMs,
    );
  } catch (error: unknown) {
    return {
      id: testCase.id,
      success: false,
      cancelled: false,
      totalLatencyMs: Math.round(performance.now() - startedAt),
      wordCount: 0,
      questionCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readDelta(line: string): string {
  const data = line.trim().replace(/^data:\s*/, '');
  if (!data || data === '[DONE]') return '';
  const payload = JSON.parse(data) as {
    choices?: Array<{ delta?: { content?: string } }>;
  };
  return payload.choices?.[0]?.delta?.content ?? '';
}

function createResult(
  id: string,
  startedAt: number,
  reply: string,
  success: boolean,
  cancelled: boolean,
  firstTokenLatencyMs?: number,
): StreamResult {
  return {
    id,
    success,
    cancelled,
    firstTokenLatencyMs,
    totalLatencyMs: Math.round(performance.now() - startedAt),
    wordCount: reply.trim() ? reply.trim().split(/\s+/).length : 0,
    questionCount: (reply.match(/\?/g) ?? []).length,
  };
}

function average(values: readonly number[]): number | undefined {
  return values.length
    ? Math.round(
        values.reduce((total, value) => total + value, 0) / values.length,
      )
    : undefined;
}

function percentile(
  values: readonly number[],
  percentileValue: number,
): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 1;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${value}ms`;
}

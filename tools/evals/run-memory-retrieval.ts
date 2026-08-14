import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dataset from './memory-retrieval.dataset.json';
import { AI_SETTINGS } from '../../apps/speak-flow/src/ai-settings';

type RetrievalCase = {
  id: string;
  query: string;
  memories: string[];
  relevantIndexes: number[];
};

type EmbeddingResponse = {
  data?: Array<{ index?: number; embedding?: unknown }>;
};

type ThresholdResult = {
  threshold: number;
  recall: number;
  precision: number;
  emptyRate: number;
};

const environment = loadEnvironmentFile();
const apiKey = environment['DASHSCOPE_API_KEY'];
const baseUrl = environment['DASHSCOPE_BASE_URL'];
const thresholds = [0.25, AI_SETTINGS.memoryRetrieval.minimumSimilarity, 0.45];
const topK = AI_SETTINGS.memoryRetrieval.topK;
const qualityGate = {
  minimumRecall: 0.9,
  minimumPrecision: 0.8,
  maximumEmptyRate: 0.4,
} as const;

if (!apiKey || !baseUrl) {
  throw new Error(
    'DASHSCOPE_API_KEY and DASHSCOPE_BASE_URL are required to run retrieval evaluation.',
  );
}
const embeddingApiKey = apiKey;
const embeddingBaseUrl = baseUrl;

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  console.log(
    `AI settings: ${AI_SETTINGS.version} (${AI_SETTINGS.memoryRetrieval.version})`,
  );
  const cases = dataset as RetrievalCase[];
  const vectorsByCase = new Map<string, number[][]>();
  for (const testCase of cases) {
    vectorsByCase.set(
      testCase.id,
      await requestEmbeddings([testCase.query, ...testCase.memories]),
    );
  }
  const results: ThresholdResult[] = [];

  for (const threshold of thresholds) {
    let relevantFound = 0;
    let relevantExpected = 0;
    let returnedRelevant = 0;
    let returnedTotal = 0;
    let emptyResults = 0;

    for (const testCase of cases) {
      const vectors = vectorsByCase.get(testCase.id);
      if (!vectors) throw new Error(`Missing vectors for ${testCase.id}`);
      const queryVector = vectors[0];
      if (!queryVector)
        throw new Error(`Missing query vector for ${testCase.id}`);

      const ranked = vectors
        .slice(1)
        .map((vector, index) => ({
          index,
          similarity: cosineSimilarity(queryVector, vector),
        }))
        .filter(({ similarity }) => similarity >= threshold)
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, topK);
      const expected = new Set(testCase.relevantIndexes);
      const found = ranked.filter(({ index }) => expected.has(index)).length;
      relevantFound += found;
      relevantExpected += expected.size;
      returnedRelevant += found;
      returnedTotal += ranked.length;
      if (!ranked.length) emptyResults += 1;
      console.log(
        `${testCase.id} threshold=${threshold.toFixed(2)} returned=${
          ranked
            .map(({ index, similarity }) => `${index}:${similarity.toFixed(3)}`)
            .join(', ') || 'none'
        }`,
      );
    }

    results.push({
      threshold,
      recall: ratio(relevantFound, relevantExpected),
      precision: ratio(returnedRelevant, returnedTotal),
      emptyRate: ratio(emptyResults, cases.length),
    });
  }

  console.log('\nRetrieval evaluation');
  console.log('Threshold | Recall@3 | Precision@3 | Empty rate');
  for (const result of results) {
    console.log(
      `${result.threshold.toFixed(2).padEnd(9)} | ${percentage(result.recall).padEnd(9)} | ${percentage(result.precision).padEnd(12)} | ${percentage(result.emptyRate)}`,
    );
  }
  const productionResult = results.find(
    ({ threshold }) =>
      threshold === AI_SETTINGS.memoryRetrieval.minimumSimilarity,
  );
  if (!productionResult)
    throw new Error('The production retrieval threshold was not evaluated.');
  const qualityGatePassed =
    productionResult.recall >= qualityGate.minimumRecall &&
    productionResult.precision >= qualityGate.minimumPrecision &&
    productionResult.emptyRate <= qualityGate.maximumEmptyRate;
  console.log(`Quality gate: ${qualityGatePassed ? 'PASS' : 'FAIL'}`);
  process.exitCode = qualityGatePassed ? 0 : 1;
}

async function requestEmbeddings(
  input: readonly string[],
): Promise<number[][]> {
  const response = await fetch(
    `${embeddingBaseUrl.replace(/\/$/, '')}/embeddings`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${embeddingApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_SETTINGS.memoryRetrieval.embeddingModel,
        input,
      }),
    },
  );
  if (!response.ok) throw new Error(`DashScope returned ${response.status}`);
  const result = (await response.json()) as EmbeddingResponse;
  if (!Array.isArray(result.data) || result.data.length !== input.length) {
    throw new Error('Embedding response has an unexpected data array.');
  }
  const items = [...result.data].sort(
    (left, right) => (left.index ?? -1) - (right.index ?? -1),
  );
  return items.map((item, expectedIndex) => {
    if (item.index !== expectedIndex || !isVector(item.embedding)) {
      throw new Error('Embedding response contains an invalid item.');
    }
    return item.embedding;
  });
}

function isVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length)
    throw new Error('Vector dimensions differ.');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator === 0 ? 0 : dot / denominator;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function loadEnvironmentFile(): Readonly<Record<string, string>> {
  const environment = { ...process.env } as Record<string, string>;
  const path = resolve(process.cwd(), '.env');
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match?.[1] || !match[2]) continue;
      const [, key, rawValue] = match;
      if (environment[key] === undefined) {
        environment[key] = rawValue.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2');
      }
    }
  } catch {
    // The command can still use environment variables supplied by the shell.
  }
  return environment;
}

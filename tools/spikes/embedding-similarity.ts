type EmbeddingResponse = {
  data?: Array<{ index?: number; embedding?: unknown }>;
  model?: string;
  usage?: unknown;
};

type EmbeddingVector = number[];

const texts = [
  'I am preparing for an English interview.',
  'How should I get ready for my job interview?',
  'My favorite food is pizza.',
] as const;

const apiKey = getRequiredEnvironmentVariable('DASHSCOPE_API_KEY');
const baseUrl = getRequiredEnvironmentVariable('DASHSCOPE_BASE_URL');

const endpoint = `${baseUrl}/embeddings`;

async function requestEmbeddings(
  endpoint: string,
  apiKey: string,
  input: readonly string[],
): Promise<EmbeddingVector[]> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-v4',
      input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding request failed: ${errorText}`);
  }

  const result = (await response.json()) as EmbeddingResponse;

  if (!Array.isArray(result.data)) {
    throw new Error('Embedding response does not contain a data array.');
  }

  if (result.data.length !== input.length) {
    throw new Error(
      `Expected ${input.length} embeddings, but received ${result.data.length}.`,
    );
  }

  for (const item of result.data) {
    if (typeof item.index !== 'number' || !Number.isInteger(item.index)) {
      throw new Error('Embedding response contains an invalid index.');
    }

    if (!isEmbeddingVector(item.embedding)) {
      throw new Error(
        `Embedding at index ${item.index} is not a valid number vector.`,
      );
    }
  }

  const orderedItems = [...result.data].sort(
    (a, b) => (a.index ?? -1) - (b.index ?? -1),
  );

  orderedItems.forEach((item, expectedIndex) => {
    if (item.index !== expectedIndex) {
      throw new Error(
        `Expected embedding index ${expectedIndex}, but received ${item.index}.`,
      );
    }
  });

  const vectors = orderedItems.map((item) => {
    if (!isEmbeddingVector(item.embedding)) {
      throw new Error(`Embedding at index ${item.index} is invalid.`);
    }
    return item.embedding;
  });
  const dimensions = vectors[0].length;
  if (!vectors.every((vector) => vector.length === dimensions)) {
    throw new Error('Embedding vectors have inconsistent dimensions.');
  }

  return vectors;
}

function isEmbeddingVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item: unknown) => typeof item === 'number' && Number.isFinite(item),
    )
  );
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length) {
    throw new Error(`Expected same length for cosine similarity`);
  }

  let dot = 0,
    leftSquaredSum = 0,
    rightSquaredSum = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    leftSquaredSum += left[i] * left[i];
    rightSquaredSum += right[i] * right[i];
  }

  const leftNorm = Math.sqrt(leftSquaredSum);
  const rightNorm = Math.sqrt(rightSquaredSum);
  if (leftNorm === 0 || rightNorm === 0) {
    throw new Error(`invalid input`);
  }
  return dot / (leftNorm * rightNorm);
}

async function main(): Promise<void> {
  const vectors = await requestEmbeddings(endpoint, apiKey, texts);

  const similarityAB = cosineSimilarity(vectors[0], vectors[1]);
  const similarityAC = cosineSimilarity(vectors[0], vectors[2]);

  const firstVector = vectors[0];
  if (!firstVector) {
    throw new Error('No embedding vectors were returned.');
  }

  console.log(`Vector count: ${vectors.length}`);
  console.log(`Embedding dimension: ${firstVector.length}`);

  console.log(`Similarity A-B: ${similarityAB.toFixed(4)}`);
  console.log(`Similarity A-C: ${similarityAC.toFixed(4)}`);

  if (similarityAB <= similarityAC) {
    throw new Error(
      'Expected the interview texts to be more similar than the unrelated food text.',
    );
  }
}

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

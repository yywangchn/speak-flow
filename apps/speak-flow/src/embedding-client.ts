export type EmbeddingClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
};

export type EmbeddingVector = number[];

type EmbeddingResponse = {
  data?: Array<{
    index?: number;
    embedding?: unknown;
  }>;
};

export async function requestEmbeddings(
  input: readonly string[],
  options: EmbeddingClientOptions,
): Promise<EmbeddingVector[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  const response = await fetchFn(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-v4',
      input,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Embedding request failed: ${message}`);
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

  if (
    !result.data.every(
      (item) =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    )
  ) {
    throw new Error('Embedding response contains an invalid data item.');
  }

  const orderedItems = [...result.data].sort(
    (left, right) => (left.index ?? -1) - (right.index ?? -1),
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
      throw new Error('Embedding response contains an invalid vector.');
    }

    return item.embedding;
  });

  const dimensions = vectors[0]?.length;
  if (dimensions === undefined) {
    return [];
  }

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

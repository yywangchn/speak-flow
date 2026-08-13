import { describe, expect, it, vi } from 'vitest';
import { requestEmbeddings } from './embedding-client';

function createFetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('requestEmbeddings', () => {
  it('sends the request and returns vectors in input order', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      createFetchResponse({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    );

    const result = await requestEmbeddings(['hello', 'world'], {
      apiKey: 'test-key',
      baseUrl: 'https://example.com/',
      fetchFn,
    });

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'text-embedding-v4',
          input: ['hello', 'world'],
        }),
      }),
    );
  });

  it('throws the API error for a non-success response', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createFetchResponse('upstream failure', 500));

    await expect(
      requestEmbeddings(['hello'], {
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        fetchFn,
      }),
    ).rejects.toThrow('Embedding request failed: "upstream failure"');
  });

  it('rejects a response without data', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createFetchResponse({ result: [] }));

    await expect(
      requestEmbeddings(['hello'], {
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        fetchFn,
      }),
    ).rejects.toThrow('Embedding response does not contain a data array.');
  });

  it('rejects non-object data items', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createFetchResponse({ data: [null] }));

    await expect(
      requestEmbeddings(['hello'], {
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        fetchFn,
      }),
    ).rejects.toThrow('Embedding response contains an invalid data item.');
  });

  it('rejects invalid or inconsistent vectors', async () => {
    const invalidFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        createFetchResponse({ data: [{ index: 0, embedding: [0.1, 'bad'] }] }),
      );
    const inconsistentFetch = vi.fn<typeof fetch>().mockResolvedValue(
      createFetchResponse({
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3] },
        ],
      }),
    );

    await expect(
      requestEmbeddings(['hello'], {
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        fetchFn: invalidFetch,
      }),
    ).rejects.toThrow('Embedding response contains an invalid vector.');
    await expect(
      requestEmbeddings(['hello', 'world'], {
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        fetchFn: inconsistentFetch,
      }),
    ).rejects.toThrow('Embedding vectors have inconsistent dimensions.');
  });

  it('rejects a response with the wrong number of vectors', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        createFetchResponse({ data: [{ index: 0, embedding: [0.1] }] }),
      );

    await expect(
      requestEmbeddings(['hello', 'world'], {
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        fetchFn,
      }),
    ).rejects.toThrow('Expected 2 embeddings, but received 1.');
  });
});

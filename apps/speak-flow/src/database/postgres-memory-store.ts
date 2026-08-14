import { Memory, MemoryCategory } from '@speak-flow/memory-models';
import { EMBEDDING_MODEL } from '../embedding-client';
import type { ExtractedMemory } from '../memory-extraction';
import type { MemoryEmbedding, RelevantMemory } from '../memory-store';
import { getPostgresPool } from './postgres';

type MemoryRow = {
  id: string;
  user_id: string;
  content: string;
  category: MemoryCategory;
  source: 'conversation' | 'manual';
  confidence: number;
  created_at: Date;
  updated_at: Date;
  embedding?: string | null;
};

export async function listPostgresMemories(userId: string): Promise<Memory[]> {
  const result = await getPostgresPool().query<MemoryRow>(
    'SELECT * FROM memories WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  );
  return result.rows.map(toMemory);
}

export async function findRelevantPostgresMemories(
  userId: string,
  queryVector: readonly number[],
  options: { limit?: number; minimumSimilarity?: number } = {},
): Promise<RelevantMemory[]> {
  const limit = options.limit ?? 3;
  const minimumSimilarity = options.minimumSimilarity ?? 0.35;
  if (limit <= 0 || !Number.isFinite(limit)) return [];
  const result = await getPostgresPool().query<MemoryRow>(
    `SELECT *, embedding::text AS embedding FROM memories
     WHERE user_id = $1 AND embedding IS NOT NULL AND embedding_model = $2`,
    [userId, EMBEDDING_MODEL],
  );
  return result.rows
    .flatMap((row) => {
      const vector = parseVector(row.embedding);
      if (!vector || vector.length !== queryVector.length) return [];
      const similarity = cosineSimilarity(queryVector, vector);
      return similarity >= minimumSimilarity
        ? [{ ...toMemory(row), similarity }]
        : [];
    })
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, Math.floor(limit));
}

export async function deletePostgresMemory(
  userId: string,
  memoryId: string,
): Promise<boolean> {
  const result = await getPostgresPool().query(
    'DELETE FROM memories WHERE user_id = $1 AND id = $2',
    [userId, memoryId],
  );
  return Boolean(result.rowCount);
}

export async function savePostgresMemories(
  userId: string,
  memories: readonly ExtractedMemory[],
  embeddings: readonly (MemoryEmbedding | null)[] = memories.map(() => null),
): Promise<void> {
  if (embeddings.length !== memories.length)
    throw new Error('Each memory must have a corresponding embedding.');
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    for (const [index, memory] of memories.entries()) {
      const embedding = embeddings[index];
      const vector = embedding ? `[${embedding.vector.join(',')}]` : null;
      const updated = await client.query(
        `UPDATE memories SET content = $3, category = $4, confidence = $5,
           embedding = CASE WHEN content <> $3 THEN $6::vector ELSE COALESCE($6::vector, embedding) END,
           embedding_model = CASE WHEN content <> $3 THEN $7 ELSE COALESCE($7, embedding_model) END,
           updated_at = NOW()
         WHERE user_id = $1 AND memory_key = $2`,
        [
          userId,
          memory.key,
          memory.content,
          memory.category,
          memory.confidence,
          vector,
          embedding?.model ?? null,
        ],
      );
      if (!updated.rowCount) {
        await client.query(
          `INSERT INTO memories (user_id, memory_key, content, category, source, confidence, embedding, embedding_model)
           VALUES ($1, $2, $3, $4, 'conversation', $5, $6::vector, $7)
           ON CONFLICT (user_id, content) DO UPDATE SET memory_key = EXCLUDED.memory_key,
             category = EXCLUDED.category, confidence = EXCLUDED.confidence,
             embedding = COALESCE(EXCLUDED.embedding, memories.embedding),
             embedding_model = COALESCE(EXCLUDED.embedding_model, memories.embedding_model), updated_at = NOW()`,
          [
            userId,
            memory.key,
            memory.content,
            memory.category,
            memory.confidence,
            vector,
            embedding?.model ?? null,
          ],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    category: row.category,
    source: row.source,
    confidence: row.confidence,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function parseVector(value: string | null | undefined): number[] | null {
  if (!value) return null;
  const vector = value.slice(1, -1).split(',').map(Number);
  return vector.length && vector.every(Number.isFinite) ? vector : null;
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator ? dot / denominator : 0;
}

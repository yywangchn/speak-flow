import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Memory, MemoryCategory } from '@speak-flow/memory-models';
import { ExtractedMemory } from './memory-extraction';
import { EMBEDDING_MODEL, EmbeddingVector } from './embedding-client';

export type MemoryEmbedding = {
  vector: EmbeddingVector;
  model: typeof EMBEDDING_MODEL;
};

export type RelevantMemory = Memory & { similarity: number };

type MemoryRow = {
  id: string;
  user_id: string;
  content: string;
  category: MemoryCategory;
  source: 'conversation' | 'manual';
  confidence: number;
  created_at: string;
  updated_at: string;
  memory_key?: string;
  embedding: string | null;
  embedding_model: string | null;
};

const databasePath =
  process.env['SPEAKFLOW_DATABASE_PATH'] ??
  resolve(process.cwd(), 'data/speak-flow.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
database.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT NOT NULL,
    confidence REAL NOT NULL,
    memory_key TEXT,
    embedding TEXT,
    embedding_model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, content)
  );
  CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories(user_id);
`);
const memoryColumns = database
  .prepare("PRAGMA table_info('memories')")
  .all() as Array<{ name: string }>;

const memoryColumnNames = new Set(memoryColumns.map(({ name }) => name));

if (!memoryColumnNames.has('memory_key')) {
  database.exec('ALTER TABLE memories ADD COLUMN memory_key TEXT');
}

if (!memoryColumnNames.has('embedding')) {
  database.exec('ALTER TABLE memories ADD COLUMN embedding TEXT');
}

if (!memoryColumnNames.has('embedding_model')) {
  database.exec('ALTER TABLE memories ADD COLUMN embedding_model TEXT');
}

export function listMemories(userId: string): Memory[] {
  const rows = database
    .prepare(
      'SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC',
    )
    .all(userId) as MemoryRow[];
  return rows.map(toMemory);
}

export function findRelevantMemories(
  userId: string,
  queryVector: readonly number[],
  options: { limit?: number; minimumSimilarity?: number } = {},
): RelevantMemory[] {
  const limit = options.limit ?? 3;
  const minimumSimilarity = options.minimumSimilarity ?? 0.35;
  if (limit <= 0 || !Number.isFinite(limit)) return [];

  const rows = database
    .prepare(
      `SELECT * FROM memories
       WHERE user_id = ? AND embedding IS NOT NULL AND embedding_model = ?`,
    )
    .all(userId, EMBEDDING_MODEL) as MemoryRow[];

  return rows
    .flatMap((row) => {
      const vector = parseEmbedding(row.embedding);
      if (!vector || vector.length !== queryVector.length) return [];
      const similarity = cosineSimilarity(queryVector, vector);
      return similarity >= minimumSimilarity
        ? [{ ...toMemory(row), similarity }]
        : [];
    })
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, Math.floor(limit));
}

export function deleteMemory(userId: string, memoryId: string): boolean {
  const result = database
    .prepare('DELETE FROM memories WHERE user_id = ? AND id = ?')
    .run(userId, memoryId);
  return result.changes > 0;
}

export function extractMemories(userId: string, text: string): void {
  const candidates: Array<{ content: string; category: MemoryCategory }> = [];
  const normalized = text.trim().replace(/\s+/g, ' ');
  const patterns: Array<{
    pattern: RegExp;
    category: MemoryCategory;
    prefix: string;
  }> = [
    {
      pattern: /^(?:my name is|call me) ([a-z][a-z .'-]{1,60})$/i,
      category: 'profile',
      prefix: "The user's name is ",
    },
    {
      pattern: /^(?:i am|i'm) working on (.+)$/i,
      category: 'project',
      prefix: 'The user is working on ',
    },
    {
      pattern: /^i prefer (.+)$/i,
      category: 'preference',
      prefix: 'The user prefers ',
    },
    {
      pattern: /^(?:i am|i'm) preparing for (.+)$/i,
      category: 'goal',
      prefix: 'The user is preparing for ',
    },
    {
      pattern: /^my goal is to (.+)$/i,
      category: 'goal',
      prefix: "The user's goal is to ",
    },
  ];
  for (const { pattern, category, prefix } of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1])
      candidates.push({
        content: `${prefix}${match[1].replace(/[.!?]+$/, '')}.`,
        category,
      });
  }
  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT INTO memories (id, user_id, content, category, source, confidence, created_at, updated_at)
    VALUES (@id, @userId, @content, @category, 'conversation', 0.9, @now, @now)
    ON CONFLICT(user_id, content) DO UPDATE SET updated_at = @now
  `);
  const transaction = database.transaction(() => {
    for (const candidate of candidates)
      insert.run({ id: randomUUID(), userId, ...candidate, now });
  });
  transaction();
}

export function saveExtractedMemories(
  userId: string,
  memories: readonly ExtractedMemory[],
  embeddings: readonly (MemoryEmbedding | null)[] = memories.map(() => null),
): void {
  if (embeddings.length !== memories.length) {
    throw new Error('Each memory must have a corresponding embedding.');
  }

  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT INTO memories (id, user_id, memory_key, content, category, source, confidence, embedding, embedding_model, created_at, updated_at)
    VALUES (@id, @userId, @key, @content, @category, 'conversation', @confidence, @embedding, @embeddingModel, @now, @now)
    ON CONFLICT(user_id, content) DO UPDATE SET
      memory_key = @key,
      category = @category,
      confidence = @confidence,
      embedding = COALESCE(@embedding, embedding),
      embedding_model = COALESCE(@embeddingModel, embedding_model),
      updated_at = @now
  `);
  const updateByKey = database.prepare(`
    UPDATE memories SET
      content = @content,
      category = @category,
      confidence = @confidence,
      embedding = CASE
        WHEN content <> @content THEN @embedding
        ELSE COALESCE(@embedding, embedding)
      END,
      embedding_model = CASE
        WHEN content <> @content THEN @embeddingModel
        ELSE COALESCE(@embeddingModel, embedding_model)
      END,
      updated_at = @now
    WHERE user_id = @userId AND memory_key = @key
  `);
  const transaction = database.transaction(() => {
    for (const [index, memory] of memories.entries()) {
      const embedding = embeddings[index];
      const parameters = {
        userId,
        ...memory,
        embedding: embedding ? JSON.stringify(embedding.vector) : null,
        embeddingModel: embedding?.model ?? null,
        now,
      };
      const updated = updateByKey.run(parameters);
      if (!updated.changes) insert.run({ id: randomUUID(), ...parameters });
    }
  });
  transaction();
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    category: row.category,
    source: row.source,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseEmbedding(value: string | null): EmbeddingVector | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isEmbeddingVector(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isEmbeddingVector(value: unknown): value is EmbeddingVector {
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
  let dot = 0;
  let leftSquaredSum = 0;
  let rightSquaredSum = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftSquaredSum += left[index] * left[index];
    rightSquaredSum += right[index] * right[index];
  }
  const denominator = Math.sqrt(leftSquaredSum) * Math.sqrt(rightSquaredSum);
  return denominator === 0 ? 0 : dot / denominator;
}

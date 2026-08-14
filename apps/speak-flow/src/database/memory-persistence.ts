import type { Memory } from '@speak-flow/memory-models';
import type { ExtractedMemory } from '../memory-extraction';
import type { MemoryEmbedding, RelevantMemory } from '../memory-store';
import {
  deletePostgresMemory,
  findRelevantPostgresMemories,
  listPostgresMemories,
  savePostgresMemories,
} from './postgres-memory-store';

const usesPostgres = (): boolean =>
  process.env['SPEAKFLOW_PERSISTENCE'] !== 'sqlite' &&
  Boolean(process.env['DATABASE_URL']);

export async function listMemories(userId: string): Promise<Memory[]> {
  if (usesPostgres()) return listPostgresMemories(userId);
  const { listMemories: listSqliteMemories } = await import('../memory-store');
  return listSqliteMemories(userId);
}

export async function findRelevantMemories(
  userId: string,
  queryVector: readonly number[],
  options: { limit?: number; minimumSimilarity?: number } = {},
): Promise<RelevantMemory[]> {
  if (usesPostgres())
    return findRelevantPostgresMemories(userId, queryVector, options);
  const { findRelevantMemories: findRelevantSqliteMemories } = await import(
    '../memory-store'
  );
  return findRelevantSqliteMemories(userId, queryVector, options);
}

export async function deleteMemory(
  userId: string,
  memoryId: string,
): Promise<boolean> {
  if (usesPostgres()) return deletePostgresMemory(userId, memoryId);
  const { deleteMemory: deleteSqliteMemory } = await import('../memory-store');
  return deleteSqliteMemory(userId, memoryId);
}

export async function saveExtractedMemories(
  userId: string,
  memories: readonly ExtractedMemory[],
  embeddings?: readonly (MemoryEmbedding | null)[],
): Promise<void> {
  if (usesPostgres()) await savePostgresMemories(userId, memories, embeddings);
  else {
    const { saveExtractedMemories: saveSqliteMemories } = await import(
      '../memory-store'
    );
    saveSqliteMemories(userId, memories, embeddings);
  }
}

export async function extractMemories(
  userId: string,
  text: string,
): Promise<void> {
  if (!usesPostgres()) {
    const { extractMemories: extractSqliteMemories } = await import(
      '../memory-store'
    );
    extractSqliteMemories(userId, text);
    return;
  }
  const normalized = text.trim().replace(/\s+/g, ' ');
  const candidates: ExtractedMemory[] = [];
  const patterns: Array<{
    pattern: RegExp;
    category: ExtractedMemory['category'];
    key: string;
    prefix: string;
  }> = [
    {
      pattern: /^(?:my name is|call me) ([a-z][a-z .'-]{1,60})$/i,
      category: 'profile',
      key: 'profile.name',
      prefix: "The user's name is ",
    },
    {
      pattern: /^(?:i am|i'm) working on (.+)$/i,
      category: 'project',
      key: 'project.current',
      prefix: 'The user is working on ',
    },
    {
      pattern: /^i prefer (.+)$/i,
      category: 'preference',
      key: 'preference.general',
      prefix: 'The user prefers ',
    },
    {
      pattern: /^(?:i am|i'm) preparing for (.+)$/i,
      category: 'goal',
      key: 'goal.current',
      prefix: 'The user is preparing for ',
    },
    {
      pattern: /^my goal is to (.+)$/i,
      category: 'goal',
      key: 'goal.current',
      prefix: "The user's goal is to ",
    },
  ];
  for (const item of patterns) {
    const value = normalized.match(item.pattern)?.[1];
    if (value)
      candidates.push({
        key: item.key,
        content: `${item.prefix}${value.replace(/[.!?]+$/, '')}.`,
        category: item.category,
        confidence: 0.9,
      });
  }
  if (candidates.length) await savePostgresMemories(userId, candidates);
}

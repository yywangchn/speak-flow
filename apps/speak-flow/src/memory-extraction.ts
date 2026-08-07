import { MemoryCategory } from '@speak-flow/memory-models';

export const MEMORY_EXTRACTION_SYSTEM_PROMPT =
  'Extract only durable facts explicitly stated by the user. Ignore temporary events, guesses, sensitive data, and casual conversation. Return JSON only in the shape {"memories":[{"key":"profile.name","content":"...","category":"profile","confidence":0.95}]}. Allowed categories: profile, preference, goal, project, habit. Use stable lowercase dot-separated keys; prefer profile.name, profile.location, preference.explanation_length, preference.learning_style, goal.english_learning, goal.career, project.current, and habit.study_schedule when applicable. Return an empty memories array when nothing should be saved.';

export type ExtractedMemory = {
  key: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
};

const memoryCategories = new Set<MemoryCategory>([
  'profile',
  'preference',
  'goal',
  'project',
  'habit',
]);
const sensitiveKeyPattern =
  /(?:^|[._-])(password|passcode|pin|token|secret|api[._-]?key|credit[._-]?card|bank[._-]?account|ssn|passport)(?:$|[._-])/i;
const sensitiveContentPattern =
  /\b(password|passcode|security code|api key|access token|refresh token|credit card|bank account|social security|passport number)\b/i;

export function parseExtractedMemories(raw: string): ExtractedMemory[] {
  const content = unwrapJsonCodeFence(raw.trim());
  const parsed = JSON.parse(content) as { memories?: unknown };
  if (!Array.isArray(parsed.memories)) return [];
  return parsed.memories.filter(isValidExtractedMemory);
}

function unwrapJsonCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? value;
}

function isValidExtractedMemory(value: unknown): value is ExtractedMemory {
  if (!value || typeof value !== 'object') return false;
  const memory = value as Record<string, unknown>;
  return (
    typeof memory['key'] === 'string' &&
    /^[a-z]+\.[a-z0-9_.-]+$/.test(memory['key']) &&
    !sensitiveKeyPattern.test(memory['key']) &&
    typeof memory['content'] === 'string' &&
    memory['content'].trim().length > 0 &&
    memory['content'].length <= 300 &&
    !sensitiveContentPattern.test(memory['content']) &&
    typeof memory['category'] === 'string' &&
    memoryCategories.has(memory['category'] as MemoryCategory) &&
    typeof memory['confidence'] === 'number' &&
    memory['confidence'] >= 0.85 &&
    memory['confidence'] <= 1
  );
}

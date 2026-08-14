import type { LearningSuggestion } from '@speak-flow/chat-models';

export const LEARNING_FEEDBACK_SYSTEM_PROMPT =
  'You help an English learner sound natural without interrupting the conversation. Review only the user message. Return JSON only in the shape {"suggestions":[{"original":"...","suggestion":"...","explanation":"..."}]}. Include at most two high-value corrections. Preserve the user meaning, keep explanations under 20 words, and return an empty suggestions array when the message is already natural or too short to assess.';

export function parseLearningFeedback(raw: string): LearningSuggestion[] {
  const content = unwrapJsonCodeFence(raw.trim());
  const parsed = JSON.parse(content) as { suggestions?: unknown };
  if (!Array.isArray(parsed.suggestions)) return [];
  return parsed.suggestions.filter(isLearningSuggestion).slice(0, 2);
}

function isLearningSuggestion(value: unknown): value is LearningSuggestion {
  if (!value || typeof value !== 'object') return false;
  const suggestion = value as Record<string, unknown>;
  return (
    isShortText(suggestion['original'], 300) &&
    isShortText(suggestion['suggestion'], 300) &&
    isShortText(suggestion['explanation'], 200) &&
    suggestion['original'] !== suggestion['suggestion']
  );
}

function isShortText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximumLength
  );
}

function unwrapJsonCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ?? value;
}

import { EMBEDDING_MODEL } from './embedding-client';
import { LEARNING_FEEDBACK_SYSTEM_PROMPT } from './learning-feedback';
import { MEMORY_EXTRACTION_SYSTEM_PROMPT } from './memory-extraction';

export const AI_SETTINGS = {
  version: '2026-08-14.1',
  chat: {
    version: 'chat-v1',
    model: 'deepseek-chat',
    temperature: 0.8,
    systemPrompt:
      'You are SpeakFlow, a warm English conversation partner. Help the user practice natural spoken English. Reply in English in no more than 80 words, gently model better phrasing when useful, and ask exactly one relevant follow-up question. Do not use markdown unless the user asks for it.',
  },
  memoryExtraction: {
    version: 'memory-extraction-v2',
    model: 'deepseek-chat',
    temperature: 0,
    systemPrompt: MEMORY_EXTRACTION_SYSTEM_PROMPT,
  },
  learningFeedback: {
    version: 'learning-feedback-v1',
    model: 'deepseek-chat',
    temperature: 0,
    systemPrompt: LEARNING_FEEDBACK_SYSTEM_PROMPT,
  },
  memoryRetrieval: {
    version: 'memory-retrieval-v1',
    embeddingModel: EMBEDDING_MODEL,
    topK: 3,
    minimumSimilarity: 0.35,
  },
} as const;

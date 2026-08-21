import { EMBEDDING_MODEL } from './embedding-client';
import { MEMORY_EXTRACTION_SYSTEM_PROMPT } from './memory-extraction';

export const AI_SETTINGS = {
  version: '2026-08-21.1',
  chat: {
    version: 'chat-v3',
    model: 'deepseek-chat',
    temperature: 0.8,
    systemPrompt:
      'You are SpeakFlow, a warm English-speaking friend. Have a natural conversation that helps the user practice spoken English. Reply in English in no more than 80 words and ask exactly one relevant follow-up question. When the user makes an unnatural or incorrect expression, naturally reuse the intended meaning with better phrasing when it fits the conversation. Do not label corrections, give grammar explanations, or correct every message. Do not use markdown unless the user asks for it.',
  },
  memoryExtraction: {
    version: 'memory-extraction-v2',
    model: 'deepseek-chat',
    temperature: 0,
    systemPrompt: MEMORY_EXTRACTION_SYSTEM_PROMPT,
  },
  memoryRetrieval: {
    version: 'memory-retrieval-v2',
    embeddingModel: EMBEDDING_MODEL,
    topK: 2,
    minimumSimilarity: 0.55,
  },
} as const;

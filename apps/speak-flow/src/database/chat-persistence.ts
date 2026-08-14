import type { StoredChatMessage } from '../chat-store';
import {
  listRecentPostgresMessages,
  savePostgresChatMessage,
} from './postgres-chat-store';

const usesPostgres = (): boolean =>
  process.env['SPEAKFLOW_PERSISTENCE'] !== 'sqlite' &&
  Boolean(process.env['DATABASE_URL']);

export async function listRecentMessages(
  userId: string,
  limit = 50,
): Promise<StoredChatMessage[]> {
  if (usesPostgres()) return listRecentPostgresMessages(userId, limit);
  const { listRecentMessages } = await import('../chat-store');
  return listRecentMessages(userId, limit);
}

export async function saveChatMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  if (usesPostgres()) {
    await savePostgresChatMessage(userId, role, content);
    return;
  }
  const { saveChatMessage: saveSqliteChatMessage } = await import(
    '../chat-store'
  );
  saveSqliteChatMessage(userId, role, content);
}

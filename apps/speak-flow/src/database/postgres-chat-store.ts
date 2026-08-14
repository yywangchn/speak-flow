import { getPostgresPool } from './postgres';
import type { StoredChatMessage } from '../chat-store';

type ChatMessageRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
};

export async function listRecentPostgresMessages(
  userId: string,
  limit = 50,
): Promise<StoredChatMessage[]> {
  const result = await getPostgresPool().query<ChatMessageRow>(
    `SELECT id, role, content, created_at FROM (
       SELECT id, role, content, created_at
       FROM chat_messages WHERE user_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2
     ) recent ORDER BY created_at ASC, id ASC`,
    [userId, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function savePostgresChatMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  await getPostgresPool().query(
    'INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)',
    [userId, role, content],
  );
}

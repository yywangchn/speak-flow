import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

export type StoredChatMessage = {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: string;
};

type ChatMessageRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

const databasePath =
  process.env['SPEAKFLOW_DATABASE_PATH'] ??
  resolve(process.cwd(), 'data/speak-flow.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
database.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_messages_user_created_idx
    ON chat_messages(user_id, created_at);
`);

export function listRecentMessages(
  userId: string,
  limit = 50,
): StoredChatMessage[] {
  const rows = database
    .prepare(
      `SELECT id, role, content, created_at FROM (
        SELECT id, role, content, created_at, rowid AS message_order
        FROM chat_messages
        WHERE user_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      ) ORDER BY created_at ASC, message_order ASC`,
    )
    .all(userId, limit) as ChatMessageRow[];
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export function saveChatMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
): void {
  database
    .prepare(
      `
    INSERT INTO chat_messages (id, user_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(randomUUID(), userId, role, content, new Date().toISOString());
}

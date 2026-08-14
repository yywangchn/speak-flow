import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { createPostgresPool } from '../../apps/speak-flow/src/database/postgres';

type ChatRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};
type MemoryRow = {
  id: string;
  memory_key: string | null;
  content: string;
  category: string;
  source: string;
  confidence: number;
  embedding: string | null;
  embedding_model: string | null;
  created_at: string;
  updated_at: string;
};
type LegacyUserSummary = {
  user_id: string;
  chat_messages: number;
  memories: number;
};

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

async function main(): Promise<void> {
  const sqlitePath =
    process.env['SPEAKFLOW_DATABASE_PATH'] ??
    resolve(process.cwd(), 'data/speak-flow.sqlite');
  const sqlite = new Database(sqlitePath, { readonly: true });
  if (process.argv.includes('--list-users')) {
    const users = sqlite
      .prepare(
        `SELECT user_id, SUM(chat_messages) AS chat_messages, SUM(memories) AS memories
         FROM (
           SELECT user_id, COUNT(*) AS chat_messages, 0 AS memories FROM chat_messages GROUP BY user_id
           UNION ALL
           SELECT user_id, 0 AS chat_messages, COUNT(*) AS memories FROM memories GROUP BY user_id
         ) GROUP BY user_id ORDER BY chat_messages DESC, memories DESC`,
      )
      .all() as LegacyUserSummary[];
    console.table(users);
    sqlite.close();
    return;
  }
  const email = argument('--user-email')?.trim().toLowerCase();
  const legacyUserId = argument('--legacy-user-id');
  const useOnlyUser = process.argv.includes('--only-user');
  if ((!email && !useOnlyUser) || !legacyUserId) {
    sqlite.close();
    throw new Error(
      'Pass --list-users, or provide --legacy-user-id with --user-email or --only-user.',
    );
  }
  const chats = sqlite
    .prepare(
      'SELECT id, role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at',
    )
    .all(legacyUserId) as ChatRow[];
  const memories = sqlite
    .prepare(
      'SELECT id, memory_key, content, category, source, confidence, embedding, embedding_model, created_at, updated_at FROM memories WHERE user_id = ? ORDER BY created_at',
    )
    .all(legacyUserId) as MemoryRow[];
  sqlite.close();

  const pool = createPostgresPool();
  const client = await pool.connect();
  try {
    const user = useOnlyUser
      ? await client.query<{ id: string }>(
          'SELECT id FROM users ORDER BY created_at LIMIT 2',
        )
      : await client.query<{ id: string }>(
          'SELECT id FROM users WHERE email = $1',
          [email],
        );
    if (useOnlyUser && user.rows.length !== 1)
      throw new Error('--only-user requires exactly one PostgreSQL account.');
    const userId = user.rows[0]?.id;
    if (!userId)
      throw new Error(
        'The target PostgreSQL account does not exist. Register it first.',
      );
    await client.query('BEGIN');
    for (const row of chats) {
      await client.query(
        `INSERT INTO chat_messages (id, user_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, role = EXCLUDED.role,
           content = EXCLUDED.content, created_at = EXCLUDED.created_at`,
        [row.id, userId, row.role, row.content, row.created_at],
      );
    }
    for (const row of memories) {
      const vector = row.embedding
        ? `[${(JSON.parse(row.embedding) as number[]).join(',')}]`
        : null;
      await client.query(
        `INSERT INTO memories (id, user_id, memory_key, content, category, source, confidence,
           embedding, embedding_model, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, memory_key = EXCLUDED.memory_key,
           content = EXCLUDED.content, category = EXCLUDED.category, source = EXCLUDED.source,
           confidence = EXCLUDED.confidence, embedding = EXCLUDED.embedding,
           embedding_model = EXCLUDED.embedding_model, updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          userId,
          row.memory_key,
          row.content,
          row.category,
          row.source,
          row.confidence,
          vector,
          row.embedding_model,
          row.created_at,
          row.updated_at,
        ],
      );
    }
    await client.query('COMMIT');
    console.info(
      `Imported ${chats.length} chat messages and ${memories.length} memories.`,
    );
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'SQLite import failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});

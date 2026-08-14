CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX chat_messages_user_created_idx
  ON chat_messages(user_id, created_at DESC);

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_key TEXT,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('profile', 'preference', 'goal', 'project', 'habit')
  ),
  source TEXT NOT NULL CHECK (source IN ('conversation', 'manual')),
  confidence DOUBLE PRECISION NOT NULL CHECK (
    confidence >= 0 AND confidence <= 1
  ),
  embedding VECTOR(1024),
  embedding_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, content)
);

CREATE UNIQUE INDEX memories_user_key_idx
  ON memories(user_id, memory_key)
  WHERE memory_key IS NOT NULL;

CREATE INDEX memories_user_updated_idx
  ON memories(user_id, updated_at DESC);

CREATE INDEX memories_embedding_hnsw_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

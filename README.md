# SpeakFlow

SpeakFlow is a locally run AI English conversation companion. It focuses on a
minimal, friend-like chat experience: replies stream in real time, useful facts
become long-term memories, and English corrections are woven naturally into the
conversation instead of appearing as lessons or scorecards.

## Highlights

- Streaming DeepSeek responses with cancellation and partial-reply persistence
- Safari voice input and automatic AI reply playback using CosyVoice
- Session-based authentication with isolated chat history and memories
- PostgreSQL persistence and pgvector semantic memory retrieval
- Structured AI memory extraction with sensitive-data filtering
- Versioned prompts, model settings, retrieval thresholds, and evaluation data
- Offline evaluations for memory extraction, retrieval quality, and streaming
- Angular SSR, production container, health check, and database migrations

## Portfolio Focus

SpeakFlow demonstrates an end-to-end AI application rather than a single model
call: authenticated user isolation, durable relational data, semantic retrieval,
structured extraction with validation, streaming UX, and browser-to-cloud voice
integration all have explicit failure and cancellation paths.

The technical decisions, quality checks, and a 90-second walkthrough are in
[the portfolio demo guide](docs/portfolio-demo.md).

## Architecture

The Angular application is split into domain libraries under `libs/`. The app
project owns routing and the Express SSR/API host, while chat UI, state
coordination, and API access remain separated by library boundaries.

```text
Angular chat UI
    |  authenticated NDJSON stream
Express SSR/API
    |-- DeepSeek chat and memory extraction
    |-- DashScope text embeddings
    |-- CosyVoice speech synthesis
    `-- PostgreSQL + pgvector
          |-- users and sessions
          |-- chat history
          `-- durable memories and vectors
```

For each message, the server embeds the current text, asks pgvector for the most
relevant memories, adds only those memories to the prompt, and streams the model
reply back to Angular. Memory extraction runs after the reply and is deliberately
non-blocking, so an extraction outage does not interrupt the conversation.

## Technology

- Angular 22 standalone components, Signals, RxJS, and SCSS
- Nx integrated monorepo and Vitest
- Express 4 and Angular SSR
- PostgreSQL 16 with pgvector HNSW indexing
- DeepSeek chat completions and DashScope embeddings
- Docker Compose for the local database and production-like runtime

## Local Setup

Prerequisites:

- Node.js 22
- npm
- Docker Desktop (for PostgreSQL and pgvector)
- DeepSeek and DashScope API keys

Install dependencies and create the local environment file:

```sh
npm ci
cp .env.example .env
```

Set `DEEPSEEK_API_KEY` and `DASHSCOPE_API_KEY` in `.env`. API keys stay on the
server and must not be added to Angular configuration or client-side code.

Start PostgreSQL, apply migrations, and run the app:

```sh
docker compose up -d postgres
npm run db:migrate
npm start
```

Open `http://127.0.0.1:4200`, create a local account, and start chatting. Data is
kept in the Docker volume `postgres-data`. Stop the database without deleting
that volume with `docker compose down`.

## Voice Chat

On macOS Safari, use the microphone button to start and stop English voice
input. SpeakFlow requests microphone permission on first use and places the
final `en-US` transcript in the message field so it can be checked or edited
before sending.

Newly completed AI replies are synthesized with `cosyvoice-v3-flash` and the
`loongluca_v3` voice through an authenticated server endpoint. The speaker
button turns playback on or off, stops the current request or audio when muted,
and remembers the choice in local browser storage. Welcome text and restored
history are never read aloud. If cloud synthesis fails, playback falls back to
the browser's English voice.

Voice capture uses Safari's browser speech recognition rather than a SpeakFlow
server endpoint. Availability and recognition quality therefore depend on the
browser and operating system, and the browser may use an online system service.
Raw audio is not stored by SpeakFlow. If recognition is unavailable, the
microphone button is hidden and text chat remains fully usable.

## Quality Checks

Run the same checks used before commits:

```sh
npx prettier --check .
npx nx test speak-flow --skip-nx-cache
npx nx lint speak-flow --skip-nx-cache
npx nx build speak-flow --configuration=production --skip-nx-cache
```

PostgreSQL integration tests are opt-in and require the local database:

```sh
npm run test:postgres
```

The AI quality suites call configured model APIs and may incur a small cost:

```sh
npm run eval:memory
npm run eval:retrieval
npm run eval:stream
```

They measure extraction precision/recall and sensitive-data rejection,
retrieval Recall@3/Precision@3/empty rate, and streaming latency, failures, and
cancellation behavior. The datasets live in `tools/evals/` and are versioned
with the AI settings they validate.

To compare other CosyVoice voices, run:

```sh
npm run spike:cosyvoice
```

The spike synthesizes the same English sentence with the configured voice IDs,
saves MP3 files under the ignored `tmp/cosyvoice-spike/` directory, and reports
first-audio latency, total latency, character count, and estimated cost. Set
`COSYVOICE_PRICE_PER_10K_CHARS` to the current console price before treating the
estimate as meaningful.

## Project Layout

```text
apps/speak-flow/          Angular shell, Express API, auth, and persistence
libs/chat/                Chat models, data access, UI, and feature orchestration
libs/memory/              Shared memory models and client data access
tools/database/           SQLite-to-PostgreSQL import utility
tools/evals/              Offline AI evaluation datasets and runners
tools/spikes/             Isolated embedding and speech experiments
```

## Data Migration

The current runtime uses PostgreSQL. To import data from the earlier SQLite
prototype, first register the target account, then inspect and import the legacy
identity:

```sh
npm run db:import-sqlite -- --list-users
npm run db:import-sqlite -- --user-email you@example.com --legacy-user-id <id>
```

When PostgreSQL contains exactly one account, use:

```sh
npm run db:import-sqlite -- --only-user --legacy-user-id <id>
```

The import is idempotent and can be rerun without duplicating records.

## Production-Like Container

Although SpeakFlow is intended for local use, its production SSR image can be
verified locally:

```sh
docker compose up --build app
```

Open `http://127.0.0.1:4000`. Container startup applies pending migrations, and
`GET /api/health` reports process health.

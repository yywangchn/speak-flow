# SpeakFlow Portfolio Demo

This is a 90-second recording script for a local portfolio walkthrough. Keep
the browser at `http://127.0.0.1:4200`, use a fresh but realistic account, and
avoid showing API keys, terminal environment files, or database values.

## Recording Flow

1. Start on the login page and create an account. Explain that chat history and
   memories are scoped to the authenticated server-side user, not a browser ID.
2. Open the chat page. Send an English message containing one durable fact, such
   as your name, learning goal, or a project preference. Point out that the
   reply streams into the conversation instead of appearing at once.
3. Send a related follow-up. Explain that the server retrieves only relevant
   long-term memories from PostgreSQL with pgvector before prompting the model.
4. Refresh the page. Show that the conversation remains, then ask a question
   that demonstrates the durable fact is still remembered.
5. Use the microphone button to create editable English text. Send it and let
   the completed reply play with the `loongluca_v3` CosyVoice voice. Toggle the
   speaker once to show that playback can be stopped.
6. Finish on `README.md` and briefly point out the evaluation scripts, unit
   tests, Docker PostgreSQL setup, and server health check.

## Talking Points

- Angular standalone libraries separate UI, feature coordination, and API access.
- Chat replies use an NDJSON stream with cancellation and partial-reply persistence.
- Durable memories are extracted as structured JSON, validated for sensitive data,
  embedded, and retrieved with a pgvector cosine query.
- Session cookies keep server data ownership independent from the browser.
- Voice input stays browser-native; cloud TTS is proxied through Express so the
  DashScope key never reaches Angular.
- The project has Vitest coverage for state transitions, request failures,
  cancellation, parsing, authentication, and persistence boundaries.

## Suggested Screens

Capture three stills from the recording for a portfolio page or README update:

1. A streamed reply beside an English user message.
2. A refreshed conversation where the assistant uses a durable fact naturally.
3. The reply form with microphone and speaker controls visible.

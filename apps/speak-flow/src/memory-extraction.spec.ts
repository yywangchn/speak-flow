import { describe, expect, it } from 'vitest';
import { parseExtractedMemories } from './memory-extraction';

describe('parseExtractedMemories', () => {
  it('parses JSON wrapped in a Markdown code fence', () => {
    const result = parseExtractedMemories(`\`\`\`json
      {"memories":[{"key":"profile.name","content":"The user's name is Wang.","category":"profile","confidence":0.98}]}
    \`\`\``);

    expect(result).toEqual([
      {
        key: 'profile.name',
        content: "The user's name is Wang.",
        category: 'profile',
        confidence: 0.98,
      },
    ]);
  });

  it('rejects memories containing sensitive keys or content', () => {
    const result = parseExtractedMemories(
      JSON.stringify({
        memories: [
          {
            key: 'profile.password',
            content: 'A harmless label.',
            category: 'profile',
            confidence: 0.99,
          },
          {
            key: 'profile.note',
            content: 'The user password is hunter2.',
            category: 'profile',
            confidence: 0.99,
          },
          {
            key: 'profile.name',
            content: "The user's name is Wang.",
            category: 'profile',
            confidence: 0.99,
          },
        ],
      }),
    );

    expect(result.map(({ key }) => key)).toEqual(['profile.name']);
  });

  it('throws when the model response is not valid JSON', () => {
    expect(() => parseExtractedMemories('not json')).toThrow();
  });
});

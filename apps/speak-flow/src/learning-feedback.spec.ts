import { describe, expect, it } from 'vitest';
import { parseLearningFeedback } from './learning-feedback';

describe('parseLearningFeedback', () => {
  it('accepts fenced JSON and limits feedback to two valid suggestions', () => {
    const feedback = parseLearningFeedback(`\`\`\`json
      {"suggestions":[
        {"original":"I very like it.","suggestion":"I really like it.","explanation":"Use really to modify like."},
        {"original":"I go there yesterday.","suggestion":"I went there yesterday.","explanation":"Use the past tense with yesterday."},
        {"original":"She have a dog.","suggestion":"She has a dog.","explanation":"Use has with she."}
      ]}
    \`\`\``);

    expect(feedback).toHaveLength(2);
    expect(feedback[0]?.suggestion).toBe('I really like it.');
  });

  it('drops malformed and unchanged suggestions', () => {
    const feedback = parseLearningFeedback(
      JSON.stringify({
        suggestions: [
          {
            original: 'Already natural.',
            suggestion: 'Already natural.',
            explanation: 'No change.',
          },
          {
            original: '',
            suggestion: 'Missing original.',
            explanation: 'Invalid.',
          },
          {
            original: 'I am agree.',
            suggestion: 'I agree.',
            explanation: 'Agree does not use am.',
          },
        ],
      }),
    );

    expect(feedback).toEqual([
      {
        original: 'I am agree.',
        suggestion: 'I agree.',
        explanation: 'Agree does not use am.',
      },
    ]);
  });

  it('throws for non-JSON model output', () => {
    expect(() => parseLearningFeedback('No corrections needed.')).toThrow();
  });
});

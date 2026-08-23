import { describe, expect, it, vi } from 'vitest';
import { cutAudioSegment } from './study-audio';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(() => {
    const listeners = new Map<string, (value?: unknown) => void>();
    return {
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, listener: (value?: unknown) => void) =>
        listeners.set(event, listener),
      ),
      trigger(event: string, value?: unknown) {
        listeners.get(event)?.(value);
      },
    };
  }),
}));

describe('study audio', () => {
  it('rejects invalid ranges', async () => {
    await expect(cutAudioSegment('a', 'b', 2, 1)).rejects.toThrow(
      'valid audio segment',
    );
  });
});

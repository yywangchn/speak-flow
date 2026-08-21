import { afterEach, describe, expect, it, vi } from 'vitest';
import { synthesizeSpeech } from './cosyvoice-client';

describe('Qwen TTS client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the multimodal HTTP API and downloads the generated audio', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: { audio: { url: 'https://audio.example/reply.wav' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);

    const audio = await synthesizeSpeech({
      apiKey: 'test-key',
      text: 'Hello there.',
      model: 'qwen3-tts-vc-2026-01-22',
      voice: 'custom-voice',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'qwen3-tts-vc-2026-01-22',
          input: {
            text: 'Hello there.',
            voice: 'custom-voice',
            language_type: 'English',
          },
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://audio.example/reply.wav',
      { signal: undefined },
    );
    expect(audio).toEqual(Buffer.from([1, 2, 3]));
  });
});

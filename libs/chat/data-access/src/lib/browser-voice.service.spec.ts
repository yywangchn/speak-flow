import { TestBed } from '@angular/core/testing';
import {
  BrowserVoiceService,
  VOICE_BROWSER_WINDOW,
  VoiceBrowserWindow,
} from './browser-voice.service';

type RecognitionCallbacks = {
  result?: (event: {
    results: ArrayLike<{
      isFinal: boolean;
      0?: { transcript?: string };
    }>;
  }) => void;
  error?: (event: { error?: string }) => void;
  end?: () => void;
};

describe('BrowserVoiceService', () => {
  it('reports unsupported recognition without a browser window', () => {
    const service = createService(null);

    expect(service.recognitionSupported).toBe(false);
    expect(service.playbackEnabled()).toBe(true);
  });

  it('configures Safari recognition and returns interim and final transcripts', () => {
    const callbacks: RecognitionCallbacks = {};
    const recognition = {
      lang: '',
      continuous: true,
      interimResults: true,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      set onresult(value: RecognitionCallbacks['result'] | null) {
        callbacks.result = value ?? undefined;
      },
      set onerror(value: RecognitionCallbacks['error'] | null) {
        callbacks.error = value ?? undefined;
      },
      set onend(value: RecognitionCallbacks['end'] | null) {
        callbacks.end = value ?? undefined;
      },
    };
    const service = createService({
      webkitSpeechRecognition: class {
        constructor() {
          return recognition;
        }
      },
    });
    const transcripts: Array<{ text: string; isFinal: boolean }> = [];

    service.listen().subscribe((value) => transcripts.push(value));
    callbacks.result?.({
      results: [{ isFinal: false, 0: { transcript: '  Hello  ' } }],
    });
    callbacks.result?.({
      results: [{ isFinal: true, 0: { transcript: '  Hello there  ' } }],
    });
    callbacks.end?.();

    expect(service.recognitionSupported).toBe(true);
    expect(recognition).toMatchObject({
      lang: 'en-US',
      continuous: true,
      interimResults: true,
    });
    expect(recognition.start).toHaveBeenCalledTimes(2);
    expect(transcripts).toEqual([
      { text: 'Hello', isFinal: false },
      { text: 'Hello there', isFinal: true },
    ]);
  });

  it('restarts unexpected endings and keeps the transcript while held', () => {
    const sessions: Array<{
      callbacks: RecognitionCallbacks;
      recognition: {
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
      };
    }> = [];
    const service = createService({
      SpeechRecognition: class {
        lang = '';
        continuous = false;
        interimResults = false;
        start = vi.fn();
        stop = vi.fn();
        abort = vi.fn();
        private readonly callbacks: RecognitionCallbacks = {};
        constructor() {
          sessions.push({ callbacks: this.callbacks, recognition: this });
        }
        set onresult(value: RecognitionCallbacks['result'] | null) {
          this.callbacks.result = value ?? undefined;
        }
        set onerror(value: RecognitionCallbacks['error'] | null) {
          this.callbacks.error = value ?? undefined;
        }
        set onend(value: RecognitionCallbacks['end'] | null) {
          this.callbacks.end = value ?? undefined;
        }
      },
    });
    const transcripts: string[] = [];
    let completed = false;

    service.listen().subscribe({
      next: ({ text }) => transcripts.push(text),
      complete: () => (completed = true),
    });
    const firstSession = sessions.at(0);
    if (!firstSession) throw new Error('Recognition did not start.');
    firstSession.callbacks.result?.({
      results: [{ isFinal: true, 0: { transcript: 'Hello' } }],
    });
    firstSession.callbacks.end?.();
    const secondSession = sessions.at(1);
    if (!secondSession) throw new Error('Recognition did not restart.');
    secondSession.callbacks.result?.({
      results: [{ isFinal: false, 0: { transcript: 'how are you' } }],
    });

    expect(sessions).toHaveLength(2);
    expect(transcripts).toEqual(['Hello', 'Hello how are you']);

    service.stopListening();
    secondSession.callbacks.end?.();

    expect(secondSession.recognition.stop).toHaveBeenCalledOnce();
    expect(sessions).toHaveLength(2);
    expect(completed).toBe(true);
  });

  it('stops recognition and reports microphone permission errors', () => {
    const callbacks: RecognitionCallbacks = {};
    const recognition = {
      lang: '',
      continuous: false,
      interimResults: false,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      set onresult(value: RecognitionCallbacks['result'] | null) {
        callbacks.result = value ?? undefined;
      },
      set onerror(value: RecognitionCallbacks['error'] | null) {
        callbacks.error = value ?? undefined;
      },
      set onend(value: RecognitionCallbacks['end'] | null) {
        callbacks.end = value ?? undefined;
      },
    };
    const service = createService({
      SpeechRecognition: class {
        constructor() {
          return recognition;
        }
      },
    });
    let message = '';

    service.listen().subscribe({
      error: (error: Error) => (message = error.message),
    });
    service.stopListening();
    callbacks.error?.({ error: 'not-allowed' });

    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(message).toBe('Microphone access is required to use voice input.');
  });

  it('persists playback preference and speaks with an en-US voice', () => {
    const cancel = vi.fn();
    const speak = vi.fn();
    const setItem = vi.fn();
    const englishVoice = { lang: 'en-US' } as SpeechSynthesisVoice;
    class Utterance {
      lang = '';
      voice: SpeechSynthesisVoice | null = null;
      constructor(readonly text: string) {}
    }
    const service = createService({
      localStorage: { getItem: () => null, setItem },
      speechSynthesis: {
        cancel,
        speak,
        getVoices: () => [englishVoice],
      },
      SpeechSynthesisUtterance:
        Utterance as unknown as typeof SpeechSynthesisUtterance,
    });

    service.speak('  Welcome back.  ');
    service.setPlaybackEnabled(false);

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Welcome back.',
        lang: 'en-US',
        voice: englishVoice,
      }),
    );
    expect(setItem).toHaveBeenCalledWith(
      'speakflow.voice.playback-enabled',
      'false',
    );
  });

  it('restores a disabled playback preference', () => {
    const service = createService({
      localStorage: { getItem: () => 'false', setItem: vi.fn() },
    });

    expect(service.playbackEnabled()).toBe(false);
  });
});

function createService(browserWindow: VoiceBrowserWindow | null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      BrowserVoiceService,
      { provide: VOICE_BROWSER_WINDOW, useValue: browserWindow },
    ],
  });
  return TestBed.inject(BrowserVoiceService);
}

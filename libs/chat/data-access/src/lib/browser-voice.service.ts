import { isPlatformBrowser } from '@angular/common';
import {
  inject,
  Injectable,
  InjectionToken,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Observable } from 'rxjs';

const PLAYBACK_STORAGE_KEY = 'speakflow.voice.playback-enabled';

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly 0?: { readonly transcript?: string };
};

type SpeechRecognitionEventLike = {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = {
  readonly error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export type VoiceBrowserWindow = {
  readonly SpeechRecognition?: SpeechRecognitionConstructor;
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
  readonly speechSynthesis?: Pick<
    SpeechSynthesis,
    'cancel' | 'getVoices' | 'speak'
  >;
  readonly SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  readonly localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
};

export type VoiceTranscript = {
  readonly text: string;
  readonly isFinal: boolean;
};

export const VOICE_BROWSER_WINDOW =
  new InjectionToken<VoiceBrowserWindow | null>('VOICE_BROWSER_WINDOW', {
    providedIn: 'root',
    factory: () =>
      isPlatformBrowser(inject(PLATFORM_ID))
        ? (window as unknown as VoiceBrowserWindow)
        : null,
  });

@Injectable({ providedIn: 'root' })
export class BrowserVoiceService {
  private readonly browserWindow = inject(VOICE_BROWSER_WINDOW);
  private activeRecognition?: SpeechRecognitionLike;

  readonly recognitionSupported = Boolean(this.recognitionConstructor);
  readonly playbackEnabled = signal(this.readPlaybackPreference());

  listen(): Observable<VoiceTranscript> {
    return new Observable<VoiceTranscript>((subscriber) => {
      const Recognition = this.recognitionConstructor;
      if (!Recognition) {
        subscriber.error(new Error('Speech recognition is not supported.'));
        return;
      }

      this.activeRecognition?.abort();
      const recognition = new Recognition();
      let finished = false;
      this.activeRecognition = recognition;
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        const results = Array.from(event.results);
        const text = results
          .map((result) => result[0]?.transcript?.trim() ?? '')
          .filter(Boolean)
          .join(' ');
        if (text)
          subscriber.next({
            text,
            isFinal: results.every((result) => result.isFinal),
          });
      };
      recognition.onerror = (event) => {
        finished = true;
        this.clearRecognition(recognition);
        subscriber.error(new Error(toRecognitionErrorMessage(event.error)));
      };
      recognition.onend = () => {
        finished = true;
        this.clearRecognition(recognition);
        subscriber.complete();
      };
      recognition.start();

      return () => {
        if (!finished) recognition.abort();
        this.clearRecognition(recognition);
      };
    });
  }

  stopListening(): void {
    this.activeRecognition?.stop();
  }

  cancelListening(): void {
    this.activeRecognition?.abort();
    this.activeRecognition = undefined;
  }

  setPlaybackEnabled(enabled: boolean): void {
    this.playbackEnabled.set(enabled);
    if (!enabled) this.cancelSpeech();
    try {
      this.browserWindow?.localStorage?.setItem(
        PLAYBACK_STORAGE_KEY,
        String(enabled),
      );
    } catch {
      // Storage can be unavailable in private browsing; the in-memory choice remains valid.
    }
  }

  speak(text: string): void {
    const synthesis = this.browserWindow?.speechSynthesis;
    const Utterance = this.browserWindow?.SpeechSynthesisUtterance;
    if (!this.playbackEnabled() || !synthesis || !Utterance || !text.trim())
      return;

    synthesis.cancel();
    const utterance = new Utterance(text.trim());
    utterance.lang = 'en-US';
    utterance.voice =
      synthesis
        .getVoices()
        .find((voice) => voice.lang.toLowerCase() === 'en-us') ?? null;
    synthesis.speak(utterance);
  }

  cancelSpeech(): void {
    this.browserWindow?.speechSynthesis?.cancel();
  }

  private get recognitionConstructor():
    | SpeechRecognitionConstructor
    | undefined {
    return (
      this.browserWindow?.SpeechRecognition ??
      this.browserWindow?.webkitSpeechRecognition
    );
  }

  private readPlaybackPreference(): boolean {
    try {
      return (
        this.browserWindow?.localStorage?.getItem(PLAYBACK_STORAGE_KEY) !==
        'false'
      );
    } catch {
      return true;
    }
  }

  private clearRecognition(recognition: SpeechRecognitionLike): void {
    if (this.activeRecognition === recognition)
      this.activeRecognition = undefined;
  }
}

function toRecognitionErrorMessage(error?: string): string {
  if (error === 'not-allowed' || error === 'service-not-allowed')
    return 'Microphone access is required to use voice input.';
  if (error === 'audio-capture') return 'No microphone is available.';
  if (error === 'network') return 'Speech recognition is unavailable.';
  return 'Your speech could not be recognized. Please try again.';
}

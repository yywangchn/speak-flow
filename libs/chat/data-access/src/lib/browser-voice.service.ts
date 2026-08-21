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
  private stopRecognitionContinuation?: () => void;

  readonly recognitionSupported = Boolean(this.recognitionConstructor);
  readonly playbackEnabled = signal(this.readPlaybackPreference());

  listen(): Observable<VoiceTranscript> {
    return new Observable<VoiceTranscript>((subscriber) => {
      const Recognition = this.recognitionConstructor;
      if (!Recognition) {
        subscriber.error(new Error('Speech recognition is not supported.'));
        return;
      }

      this.stopRecognitionContinuation?.();
      this.activeRecognition?.abort();
      let finished = false;
      let shouldContinue = true;
      let committedText = '';
      let latestSessionText = '';
      const stopContinuation = (): void => {
        shouldContinue = false;
      };
      this.stopRecognitionContinuation = stopContinuation;

      const startRecognition = (): void => {
        if (!shouldContinue || finished) return;
        const recognition = new Recognition();
        latestSessionText = '';
        this.activeRecognition = recognition;
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event) => {
          const results = Array.from(event.results);
          latestSessionText = results
            .map((result) => result[0]?.transcript?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          const text = joinTranscript(committedText, latestSessionText);
          if (text)
            subscriber.next({
              text,
              isFinal: results.every((result) => result.isFinal),
            });
        };
        recognition.onerror = (event) => {
          if (event.error === 'no-speech' && shouldContinue) return;
          shouldContinue = false;
          finished = true;
          this.clearRecognition(recognition);
          subscriber.error(new Error(toRecognitionErrorMessage(event.error)));
        };
        recognition.onend = () => {
          this.clearRecognition(recognition);
          if (shouldContinue) {
            committedText = joinTranscript(committedText, latestSessionText);
            startRecognition();
            return;
          }
          finished = true;
          subscriber.complete();
        };
        recognition.start();
      };
      startRecognition();

      return () => {
        shouldContinue = false;
        if (!finished) this.activeRecognition?.abort();
        this.activeRecognition = undefined;
        if (this.stopRecognitionContinuation === stopContinuation)
          this.stopRecognitionContinuation = undefined;
      };
    });
  }

  stopListening(): void {
    // The active recognition's onend handler completes the observable.
    this.stopRecognitionContinuation?.();
    this.activeRecognition?.stop();
  }

  cancelListening(): void {
    this.stopRecognitionContinuation?.();
    this.activeRecognition?.abort();
    this.activeRecognition = undefined;
    this.stopRecognitionContinuation = undefined;
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

function joinTranscript(prefix: string, transcript: string): string {
  return [prefix.trim(), transcript.trim()].filter(Boolean).join(' ');
}

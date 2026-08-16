import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken, PLATFORM_ID } from '@angular/core';
import { Subscription } from 'rxjs';
import { BrowserVoiceService } from './browser-voice.service';

const SILENT_AUDIO_URL =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA';

export type CloudAudio = {
  src: string;
  onended: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  pause(): void;
  play(): Promise<void>;
};

export type CloudAudioBrowser = {
  createAudio(url: string): CloudAudio;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
};

export const CLOUD_AUDIO_BROWSER = new InjectionToken<CloudAudioBrowser | null>(
  'CLOUD_AUDIO_BROWSER',
  {
    providedIn: 'root',
    factory: () =>
      isPlatformBrowser(inject(PLATFORM_ID))
        ? {
            createAudio: (url) => new Audio(url),
            createObjectUrl: (blob) => URL.createObjectURL(blob),
            revokeObjectUrl: (url) => URL.revokeObjectURL(url),
          }
        : null,
  },
);

@Injectable({ providedIn: 'root' })
export class CloudSpeechService {
  private readonly http = inject(HttpClient);
  private readonly browser = inject(CLOUD_AUDIO_BROWSER);
  private readonly nativeVoice = inject(BrowserVoiceService);
  private activeRequest?: Subscription;
  private activeAudio?: CloudAudio;
  private activeObjectUrl?: string;
  private preparedAudio?: CloudAudio;

  preparePlayback(): void {
    if (
      !this.browser ||
      !this.nativeVoice.playbackEnabled() ||
      this.preparedAudio
    )
      return;

    const audio = this.browser.createAudio(SILENT_AUDIO_URL);
    this.preparedAudio = audio;
    void audio.play().then(
      () => {
        if (this.preparedAudio === audio) audio.pause();
      },
      () => {
        if (this.preparedAudio === audio) this.preparedAudio = undefined;
      },
    );
  }

  speak(text: string): void {
    const normalizedText = text.trim();
    this.cancelActiveSpeech();
    if (!normalizedText || !this.nativeVoice.playbackEnabled()) return;

    this.activeRequest = this.http
      .post('/api/speech', { text: normalizedText }, { responseType: 'blob' })
      .subscribe({
        next: (blob) => this.playBlob(blob, normalizedText),
        error: () => {
          this.activeRequest = undefined;
          this.playNativeFallback(normalizedText);
        },
      });
  }

  cancelSpeech(): void {
    this.cancelActiveSpeech();
    if (this.preparedAudio) {
      this.preparedAudio.pause();
      this.preparedAudio = undefined;
    }
  }

  private cancelActiveSpeech(): void {
    this.activeRequest?.unsubscribe();
    this.activeRequest = undefined;
    this.nativeVoice.cancelSpeech();
    this.releaseAudio();
  }

  private playBlob(blob: Blob, fallbackText: string): void {
    this.activeRequest = undefined;
    if (!this.browser || !this.nativeVoice.playbackEnabled()) return;

    const objectUrl = this.browser.createObjectUrl(blob);
    const audio = this.preparedAudio ?? this.browser.createAudio(objectUrl);
    this.preparedAudio = undefined;
    audio.src = objectUrl;
    this.activeObjectUrl = objectUrl;
    this.activeAudio = audio;
    audio.onended = () => this.releaseAudio(audio);
    audio.onerror = () => this.playNativeFallback(fallbackText, audio);
    void audio.play().catch(() => this.playNativeFallback(fallbackText, audio));
  }

  private playNativeFallback(text: string, audio?: CloudAudio): void {
    if (audio && this.activeAudio !== audio) return;
    this.releaseAudio(audio);
    if (this.nativeVoice.playbackEnabled()) this.nativeVoice.speak(text);
  }

  private releaseAudio(expectedAudio?: CloudAudio): void {
    if (expectedAudio && this.activeAudio !== expectedAudio) return;
    if (this.activeAudio) {
      this.activeAudio.onended = null;
      this.activeAudio.onerror = null;
      this.activeAudio.pause();
      this.activeAudio = undefined;
    }
    if (this.activeObjectUrl) {
      this.browser?.revokeObjectUrl(this.activeObjectUrl);
      this.activeObjectUrl = undefined;
    }
  }
}

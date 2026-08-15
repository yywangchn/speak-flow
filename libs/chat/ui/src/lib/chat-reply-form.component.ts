import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatStatus, VoiceCaptureStatus } from '@speak-flow/chat-models';

@Component({
  selector: 'chat-reply-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="composer">
      <form class="reply-form" (ngSubmit)="submitted.emit()">
        @if (voiceSupported()) {
          <button
            class="icon-button"
            type="button"
            [class.active]="voiceStatus().state === 'listening'"
            [disabled]="voiceDisabled()"
            [attr.aria-label]="
              voiceStatus().state === 'listening'
                ? 'Stop voice input'
                : 'Start voice input'
            "
            [title]="
              voiceStatus().state === 'listening'
                ? 'Stop voice input'
                : 'Start voice input'
            "
            (click)="voiceToggled.emit()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
            </svg>
          </button>
        }
        <button
          class="icon-button"
          type="button"
          [class.muted]="!playbackEnabled()"
          [attr.aria-pressed]="playbackEnabled()"
          [attr.aria-label]="
            playbackEnabled() ? 'Mute AI voice' : 'Enable AI voice'
          "
          [title]="playbackEnabled() ? 'Mute AI voice' : 'Enable AI voice'"
          (click)="playbackToggled.emit()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M11 5 6 9H2v6h4l5 4V5Z" />
            @if (playbackEnabled()) {
              <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" />
            } @else {
              <path d="m16 9 5 5M21 9l-5 5" />
            }
          </svg>
        </button>
        <label class="sr-only" for="reply">Message SpeakFlow</label>
        <textarea
          id="reply"
          name="reply"
          [ngModel]="draft()"
          (ngModelChange)="draftChange.emit($event)"
          [disabled]="
            status().state === 'sending' || status().state === 'loading'
          "
          (compositionstart)="compositionStart.emit()"
          (compositionend)="compositionEnd.emit()"
          (keydown)="keydown.emit($event)"
          rows="1"
          placeholder="Message SpeakFlow..."
        ></textarea>
        <button
          class="send-button"
          type="submit"
          [disabled]="
            !draft().trim() ||
            status().state === 'sending' ||
            status().state === 'loading'
          "
        >
          {{
            status().state === 'loading'
              ? 'Loading...'
              : status().state === 'sending'
                ? 'Thinking...'
                : status().state === 'streaming'
                  ? 'Send new message'
                  : 'Send'
          }}
        </button>
      </form>
      @if (voiceStatus(); as currentVoiceStatus) {
        @if (currentVoiceStatus.state === 'error') {
          <p class="voice-error" role="alert">
            {{ currentVoiceStatus.message }}
          </p>
        }
      }
    </div>
  `,
  styleUrl: './chat-reply-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatReplyFormComponent {
  readonly draft = input('');
  readonly status = input<ChatStatus>({ state: 'idle' });
  readonly voiceStatus = input<VoiceCaptureStatus>({ state: 'idle' });
  readonly voiceSupported = input(false);
  readonly playbackEnabled = input(true);
  readonly draftChange = output<string>();
  readonly submitted = output<void>();
  readonly voiceToggled = output<void>();
  readonly playbackToggled = output<void>();
  readonly keydown = output<KeyboardEvent>();
  readonly compositionStart = output<void>();
  readonly compositionEnd = output<void>();

  voiceDisabled(): boolean {
    const state = this.status().state;
    return (
      this.voiceStatus().state === 'processing' ||
      state === 'loading' ||
      state === 'sending' ||
      state === 'streaming'
    );
  }
}

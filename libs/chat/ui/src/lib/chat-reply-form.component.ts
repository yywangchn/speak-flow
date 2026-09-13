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
  templateUrl: './chat-reply-form.component.html',
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
  readonly voiceCaptureStarted = output<void>();
  readonly voiceCaptureStopped = output<void>();
  readonly voiceCaptureCancelled = output<void>();
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

  startVoiceCapture(event: PointerEvent): void {
    if (this.voiceDisabled() || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.voiceCaptureStarted.emit();
  }

  stopVoiceCapture(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.voiceCaptureStopped.emit();
  }

  cancelVoiceCapture(): void {
    this.voiceCaptureCancelled.emit();
  }

  startVoiceCaptureFromKeyboard(event: KeyboardEvent): void {
    if (!isVoiceActivationKey(event) || event.repeat || this.voiceDisabled())
      return;
    event.preventDefault();
    this.voiceCaptureStarted.emit();
  }

  stopVoiceCaptureFromKeyboard(event: KeyboardEvent): void {
    if (!isVoiceActivationKey(event)) return;
    event.preventDefault();
    this.voiceCaptureStopped.emit();
  }
}

function isVoiceActivationKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.key === 'Enter';
}

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  ChatStreamEvent,
  VoiceCaptureStatus,
} from '@speak-flow/chat-models';
import {
  BrowserVoiceService,
  ChatService,
  CloudSpeechService,
} from '@speak-flow/chat-data-access';
import {
  ChatMessageListComponent,
  ChatReplyFormComponent,
} from '@speak-flow/chat-ui';

@Component({
  selector: 'chat-page',
  standalone: true,
  imports: [ChatMessageListComponent, ChatReplyFormComponent, RouterLink],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPageComponent {
  private readonly chatService = inject(ChatService);
  private readonly voiceService = inject(BrowserVoiceService);
  private readonly cloudSpeech = inject(CloudSpeechService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private isComposing = false;
  private nextMessageId = 0;
  private activeStream?: Subscription;
  private activeVoiceCapture?: Subscription;
  private voiceDraftPrefix = '';

  readonly draft = signal('');
  readonly status = signal<ChatStatus>({ state: 'loading' });
  readonly voiceStatus = signal<VoiceCaptureStatus>({ state: 'idle' });
  readonly messages = signal<ChatMessage[]>([]);
  readonly voiceSupported = this.voiceService.recognitionSupported;
  readonly playbackEnabled = this.voiceService.playbackEnabled;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.voiceService.cancelListening();
      this.cloudSpeech.cancelSpeech();
    });
    this.chatService
      .loadHistory()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (history) => {
          this.messages.set(
            history.length
              ? history.map(({ id, role, content: text }) => ({
                  id,
                  role,
                  text,
                }))
              : [this.createWelcomeMessage()],
          );
          this.status.set({ state: 'idle' });
        },
        error: () => {
          this.messages.set([this.createWelcomeMessage()]);
          this.status.set({
            state: 'error',
            message:
              'Previous messages could not be loaded. You can still start a new chat.',
          });
        },
      });
  }

  sendMessage(): void {
    const text = this.draft().trim();
    if (!text || this.status().state === 'loading') return;
    this.cancelVoiceCapture();
    this.cloudSpeech.cancelSpeech();
    this.cloudSpeech.preparePlayback();
    if (this.status().state === 'streaming') {
      this.activeStream?.unsubscribe();
      this.status.set({ state: 'cancelled' });
    }
    const nextMessages = [...this.messages(), this.createMessage('user', text)];
    this.messages.set(nextMessages);
    this.draft.set('');
    this.status.set({ state: 'sending' });
    this.activeStream = this.chatService
      .streamMessage(
        nextMessages.map(({ role, text: content }) => ({ role, content })),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event: ChatStreamEvent) => {
          if (event.type === 'delta') {
            this.messages.update((messages) => {
              const lastMessage = messages.at(-1);
              if (lastMessage?.role === 'assistant') {
                return [
                  ...messages.slice(0, -1),
                  { ...lastMessage, text: lastMessage.text + event.text },
                ];
              }
              return [...messages, this.createMessage('assistant', event.text)];
            });
            this.status.set({ state: 'streaming' });
          }
          if (event.type === 'complete') {
            this.status.set({ state: 'idle' });
            const completedReply = this.messages().at(-1);
            if (completedReply?.role === 'assistant')
              this.cloudSpeech.speak(completedReply.text);
          }
          if (event.type === 'cancelled')
            this.status.set({ state: 'cancelled' });
        },
        error: () =>
          this.status.set({
            state: 'error',
            message: 'The reply could not be generated. Please try again.',
          }),
      });
  }

  startVoiceCapture(): void {
    if (this.voiceStatus().state === 'listening') return;
    if (!this.voiceSupported || this.isChatBusy()) return;

    this.cloudSpeech.cancelSpeech();
    this.voiceDraftPrefix = this.draft().trimEnd();
    this.voiceStatus.set({ state: 'listening' });
    this.activeVoiceCapture = this.voiceService
      .listen()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transcript) => this.showTranscript(transcript.text),
        error: (error: unknown) =>
          this.voiceStatus.set({
            state: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Your speech could not be recognized. Please try again.',
          }),
        complete: () => this.voiceStatus.set({ state: 'idle' }),
      });
  }

  stopVoiceCapture(): void {
    if (this.voiceStatus().state !== 'listening') return;
    this.voiceStatus.set({ state: 'processing' });
    this.voiceService.stopListening();
  }

  togglePlayback(): void {
    const enabled = !this.playbackEnabled();
    this.voiceService.setPlaybackEnabled(enabled);
    if (!enabled) this.cloudSpeech.cancelSpeech();
  }

  playMessage(text: string): void {
    this.cloudSpeech.preparePlayback();
    this.cloudSpeech.speak(text);
  }

  onReplyKeydown(event: KeyboardEvent): void {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      this.isComposing ||
      event.isComposing ||
      event.keyCode === 229
    )
      return;
    event.preventDefault();
    this.sendMessage();
  }

  onCompositionStart(): void {
    this.isComposing = true;
  }
  onCompositionEnd(): void {
    this.isComposing = false;
  }

  logout(): void {
    this.chatService
      .logout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => void this.router.navigateByUrl('/login'),
      });
  }

  private showTranscript(transcript: string): void {
    this.draft.set(
      this.voiceDraftPrefix
        ? `${this.voiceDraftPrefix} ${transcript}`
        : transcript,
    );
  }

  cancelVoiceCapture(): void {
    if (
      this.voiceStatus().state !== 'listening' &&
      this.voiceStatus().state !== 'processing'
    )
      return;
    this.activeVoiceCapture?.unsubscribe();
    this.voiceService.cancelListening();
    this.voiceStatus.set({ state: 'idle' });
  }

  private isChatBusy(): boolean {
    const state = this.status().state;
    return state === 'loading' || state === 'sending' || state === 'streaming';
  }

  private createMessage(role: ChatRole, text: string): ChatMessage {
    this.nextMessageId += 1;
    return { id: `message-${this.nextMessageId}`, role, text };
  }

  private createWelcomeMessage(): ChatMessage {
    return {
      id: 'welcome',
      role: 'assistant',
      text: "Hey! It's nice to chat with you. How's your day going?",
    };
  }
}

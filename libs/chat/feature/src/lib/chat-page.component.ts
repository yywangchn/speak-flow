import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  ChatStreamEvent,
} from '@speak-flow/chat-models';
import { ChatService } from '@speak-flow/chat-data-access';
import {
  ChatMessageListComponent,
  ChatReplyFormComponent,
} from '@speak-flow/chat-ui';

@Component({
  selector: 'chat-page',
  standalone: true,
  imports: [ChatMessageListComponent, ChatReplyFormComponent],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPageComponent {
  private readonly chatService = inject(ChatService);
  private readonly destroyRef = inject(DestroyRef);
  private isComposing = false;
  private nextMessageId = 0;
  private activeStream?: Subscription;

  readonly draft = signal('');
  readonly status = signal<ChatStatus>({ state: 'loading' });
  readonly messages = signal<ChatMessage[]>([]);

  constructor() {
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
          if (event.type === 'complete') this.status.set({ state: 'idle' });
        },
        error: () =>
          this.status.set({
            state: 'error',
            message: 'The reply could not be generated. Please try again.',
          }),
      });
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

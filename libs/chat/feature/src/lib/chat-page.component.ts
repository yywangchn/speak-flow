import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChatMessage, ChatRole, ChatStatus } from '@speak-flow/chat-models';
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

  readonly draft = signal('');
  readonly status = signal<ChatStatus>({ state: 'idle' });
  readonly messages = signal<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hey! It's nice to chat with you. How's your day going?",
    },
  ]);

  sendMessage(): void {
    const text = this.draft().trim();
    if (!text || this.status().state === 'sending') return;
    const nextMessages = [...this.messages(), this.createMessage('user', text)];
    this.messages.set(nextMessages);
    this.draft.set('');
    this.status.set({ state: 'sending' });
    this.chatService
      .sendMessage(
        nextMessages.map(({ role, text: content }) => ({ role, content })),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reply) => {
          this.messages.update((messages) => [
            ...messages,
            this.createMessage('assistant', reply),
          ]);
          this.status.set({ state: 'idle' });
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
}

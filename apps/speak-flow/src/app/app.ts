import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChatMessage, ChatService } from '@speak-flow/chat-data-access';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type ChatStatus =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'error'; message: string };

@Component({
  imports: [CommonModule, FormsModule, RouterModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly chatService = inject(ChatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly draft = signal('');
  readonly status = signal<ChatStatus>({ state: 'idle' });
  readonly messages = signal<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hey! It's nice to chat with you. How's your day going?",
    },
  ]);
  private isComposing = false;
  private nextMessageId = 0;

  sendMessage(): void {
    const text = this.draft().trim();
    if (!text || this.status().state === 'sending') return;

    const nextMessages: Message[] = [
      ...this.messages(),
      { id: this.createMessageId(), role: 'user', text },
    ];
    this.messages.set(nextMessages);
    this.draft.set('');
    this.status.set({ state: 'sending' });

    const apiMessages: ChatMessage[] = nextMessages.map((message) => ({
      role: message.role,
      content: message.text,
    }));
    this.chatService
      .sendMessage(apiMessages)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (reply) => {
          this.messages.update((messages) => [
            ...messages,
            { id: this.createMessageId(), role: 'assistant', text: reply },
          ]);
          this.status.set({ state: 'idle' });
        },
        error: () => {
          this.status.set({
            state: 'error',
            message: 'The reply could not be generated. Please try again.',
          });
        },
      });
  }

  onReplyKeydown(event: KeyboardEvent): void {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      this.isComposing ||
      event.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }

    event.preventDefault();
    void this.sendMessage();
  }

  onCompositionStart(): void {
    this.isComposing = true;
  }

  onCompositionEnd(): void {
    this.isComposing = false;
  }

  private createMessageId(): string {
    this.nextMessageId += 1;
    return `message-${this.nextMessageId}`;
  }
}

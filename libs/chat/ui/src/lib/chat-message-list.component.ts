import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ChatMessage } from '@speak-flow/chat-models';

@Component({
  selector: 'chat-message-list',
  standalone: true,
  template: `
    <div
      #messageContainer
      class="messages"
      aria-live="polite"
      (scroll)="onScroll()"
    >
      @for (message of messages(); track message.id) {
        <div class="message" [class.user-message]="message.role === 'user'">
          <span class="message-role">{{
            message.role === 'user' ? 'You' : 'SpeakFlow'
          }}</span>
          <p>{{ message.text }}</p>
        </div>
      }
    </div>
    @if (showLatest()) {
      <button
        class="latest-button"
        type="button"
        title="Go to latest message"
        aria-label="Go to latest message"
        (click)="scrollToLatest()"
      >
        ↓
      </button>
    }
  `,
  styleUrl: './chat-message-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatMessageListComponent {
  private readonly messageContainer =
    viewChild<ElementRef<HTMLDivElement>>('messageContainer');
  private previousMessageCount = 0;
  private previousLatestMessageId: string | undefined;
  private previousLatestMessageText: string | undefined;
  private isNearBottom = true;

  readonly messages = input<readonly ChatMessage[]>([]);
  readonly showLatest = signal(false);

  constructor() {
    afterRenderEffect(() => {
      const messages = this.messages();
      const messageCount = messages.length;
      const latestMessage = messages.at(-1);
      const isNewMessage = latestMessage?.id !== this.previousLatestMessageId;
      const latestTextChanged =
        latestMessage?.text !== this.previousLatestMessageText;
      if (
        messageCount === this.previousMessageCount &&
        !isNewMessage &&
        !latestTextChanged
      )
        return;

      const isInitialMessage = this.previousMessageCount === 0;
      const shouldFollow =
        isInitialMessage ||
        this.isNearBottom ||
        (isNewMessage && latestMessage?.role === 'user');
      this.previousMessageCount = messageCount;
      this.previousLatestMessageId = latestMessage?.id;
      this.previousLatestMessageText = latestMessage?.text;

      if (shouldFollow) {
        const behavior =
          isInitialMessage || !isNewMessage || latestMessage?.role === 'user'
            ? 'auto'
            : 'smooth';
        this.scrollToLatest(behavior);
      } else {
        this.showLatest.set(true);
      }
    });
  }

  onScroll(): void {
    const container = this.messageContainer()?.nativeElement;
    if (!container) return;
    this.isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      48;
    if (this.isNearBottom) this.showLatest.set(false);
  }

  scrollToLatest(behavior: ScrollBehavior = 'smooth'): void {
    const container = this.messageContainer()?.nativeElement;
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      container.scrollTop = container.scrollHeight;
    }
    this.isNearBottom = true;
    this.showLatest.set(false);
  }
}

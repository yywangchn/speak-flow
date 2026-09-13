import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ChatMessage } from '@speak-flow/chat-models';
import { MarkdownComponent } from 'ngx-markdown';

@Component({
  selector: 'chat-message-list',
  standalone: true,
  imports: [MarkdownComponent],
  templateUrl: './chat-message-list.component.html',
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
  readonly playRequested = output<string>();
  readonly showLatest = signal(false);
  private readonly expandedMessageIds = signal<ReadonlySet<string>>(new Set());

  isExpanded(messageId: string): boolean {
    return this.expandedMessageIds().has(messageId);
  }

  toggleExpanded(messageId: string): void {
    this.expandedMessageIds.update((expanded) => {
      const next = new Set(expanded);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

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

  onMarkdownReady(messageId: string): void {
    if (this.messages().at(-1)?.id === messageId && this.isNearBottom)
      this.scrollToLatest('auto');
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

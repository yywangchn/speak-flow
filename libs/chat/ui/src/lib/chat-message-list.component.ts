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
          @if (message.suggestions?.length) {
            <div class="suggestions" aria-label="English suggestions">
              @for (
                suggestion of message.suggestions;
                track suggestion.original + suggestion.suggestion
              ) {
                <div class="suggestion">
                  <span>{{ suggestion.original }}</span>
                  <strong>{{ suggestion.suggestion }}</strong>
                  <small>{{ suggestion.explanation }}</small>
                </div>
              }
            </div>
          }
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
  private isNearBottom = true;

  readonly messages = input<readonly ChatMessage[]>([]);
  readonly showLatest = signal(false);

  constructor() {
    afterRenderEffect(() => {
      const messages = this.messages();
      const messageCount = messages.length;
      if (messageCount === this.previousMessageCount) return;

      const latestMessage = messages.at(-1);
      const shouldFollow =
        this.previousMessageCount === 0 ||
        this.isNearBottom ||
        latestMessage?.role === 'user';
      this.previousMessageCount = messageCount;

      if (shouldFollow) {
        this.scrollToLatest(
          this.previousMessageCount === 0 ? 'auto' : 'smooth',
        );
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

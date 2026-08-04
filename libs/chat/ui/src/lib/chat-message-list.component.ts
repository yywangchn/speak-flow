import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ChatMessage } from '@speak-flow/chat-models';

@Component({
  selector: 'chat-message-list',
  standalone: true,
  template: `
    <div class="messages" aria-live="polite">
      @for (message of messages(); track message.id) {
        <div class="message" [class.user-message]="message.role === 'user'">
          <span class="message-role">{{
            message.role === 'user' ? 'You' : 'SpeakFlow'
          }}</span>
          <p>{{ message.text }}</p>
        </div>
      }
    </div>
  `,
  styleUrl: './chat-message-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatMessageListComponent {
  readonly messages = input<readonly ChatMessage[]>([]);
}

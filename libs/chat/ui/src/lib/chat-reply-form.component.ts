import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatStatus } from '@speak-flow/chat-models';

@Component({
  selector: 'chat-reply-form',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form class="reply-form" (ngSubmit)="submitted.emit()">
      <label class="sr-only" for="reply">Message SpeakFlow</label>
      <textarea
        id="reply"
        name="reply"
        [ngModel]="draft()"
        (ngModelChange)="draftChange.emit($event)"
        [disabled]="
          status().state === 'sending' ||
          status().state === 'streaming' ||
          status().state === 'loading'
        "
        (compositionstart)="compositionStart.emit()"
        (compositionend)="compositionEnd.emit()"
        (keydown)="keydown.emit($event)"
        rows="1"
        placeholder="Message SpeakFlow..."
      ></textarea>
      <button
        type="submit"
        [disabled]="
          !draft().trim() ||
          status().state === 'sending' ||
          status().state === 'streaming' ||
          status().state === 'loading'
        "
      >
        {{
          status().state === 'loading'
            ? 'Loading...'
            : status().state === 'sending'
              ? 'Thinking...'
              : status().state === 'streaming'
                ? 'Replying...'
                : 'Send'
        }}
      </button>
    </form>
  `,
  styleUrl: './chat-reply-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatReplyFormComponent {
  readonly draft = input('');
  readonly status = input<ChatStatus>({ state: 'idle' });
  readonly draftChange = output<string>();
  readonly submitted = output<void>();
  readonly keydown = output<KeyboardEvent>();
  readonly compositionStart = output<void>();
  readonly compositionEnd = output<void>();
}

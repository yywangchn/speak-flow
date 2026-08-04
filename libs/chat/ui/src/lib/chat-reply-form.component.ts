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
      <label for="reply">Your reply</label>
      <textarea
        id="reply"
        name="reply"
        [ngModel]="draft()"
        (ngModelChange)="draftChange.emit($event)"
        [disabled]="status().state === 'sending'"
        (compositionstart)="compositionStart.emit()"
        (compositionend)="compositionEnd.emit()"
        (keydown)="keydown.emit($event)"
        rows="3"
        placeholder="Type what you would say..."
      ></textarea>
      <div class="form-actions">
        <span class="helper-text"
          >Keep it natural. There is no perfect answer.</span
        >
        <button
          type="submit"
          [disabled]="!draft().trim() || status().state === 'sending'"
        >
          {{ status().state === 'sending' ? 'Thinking...' : 'Send reply' }}
        </button>
      </div>
    </form>
  `,
  styleUrl: './chat-reply-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatReplyFormComponent {
  readonly draft = input.required<string>();
  readonly status = input.required<ChatStatus>();
  readonly draftChange = output<string>();
  readonly submitted = output<void>();
  readonly keydown = output<KeyboardEvent>();
  readonly compositionStart = output<void>();
  readonly compositionEnd = output<void>();
}

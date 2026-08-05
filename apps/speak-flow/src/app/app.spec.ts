import { TestBed } from '@angular/core/testing';
import { ChatService } from '@speak-flow/chat-data-access';
import { of, Subject, throwError } from 'rxjs';
import { ChatPageComponent } from '@speak-flow/chat-feature';

describe('ChatPageComponent', () => {
  const chatService = {
    sendMessage: vi.fn(),
  };

  beforeEach(async () => {
    chatService.sendMessage.mockReset();
    await TestBed.configureTestingModule({
      imports: [ChatPageComponent],
      providers: [{ provide: ChatService, useValue: chatService }],
    }).compileComponents();
  });

  it('renders the chat conversation', () => {
    const fixture = TestBed.createComponent(ChatPageComponent);

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toContain('SpeakFlow');
  });

  it('sends a reply on Enter and appends the API response', () => {
    chatService.sendMessage.mockReturnValue(
      of('That sounds good. What have you been up to?'),
    );
    const fixture = TestBed.createComponent(ChatPageComponent);
    const component = fixture.componentInstance;
    component.draft.set('I am doing well today.');

    component.onReplyKeydown(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    );

    expect(chatService.sendMessage).toHaveBeenCalledOnce();
    expect(component.messages().at(-2)?.text).toBe('I am doing well today.');
    expect(component.messages().at(-1)?.text).toBe(
      'That sounds good. What have you been up to?',
    );
    expect(component.status()).toEqual({ state: 'idle' });
  });

  it('keeps Shift+Enter available for a new line', () => {
    const fixture = TestBed.createComponent(ChatPageComponent);
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      cancelable: true,
    });

    fixture.componentInstance.onReplyKeydown(event);

    expect(event.defaultPrevented).toBe(false);
    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send Enter while an IME composition is active', () => {
    const fixture = TestBed.createComponent(ChatPageComponent);
    const component = fixture.componentInstance;
    component.draft.set('ni hao');
    component.onCompositionStart();

    component.onReplyKeydown(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    );

    expect(chatService.sendMessage).not.toHaveBeenCalled();
    expect(component.status()).toEqual({ state: 'idle' });
    component.onCompositionEnd();
  });

  it('ignores another submission while a reply is pending', () => {
    chatService.sendMessage.mockReturnValue(new Subject<string>());
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;
    component.draft.set('First message');

    component.sendMessage();
    component.draft.set('Second message');
    component.sendMessage();

    expect(chatService.sendMessage).toHaveBeenCalledOnce();
    expect(
      component.messages().filter(({ role }) => role === 'user'),
    ).toHaveLength(1);
  });

  it('shows a recoverable error when the request fails', () => {
    chatService.sendMessage.mockReturnValue(
      throwError(() => new Error('Request failed')),
    );
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;
    component.draft.set('Hello');

    component.sendMessage();

    expect(component.status()).toEqual({
      state: 'error',
      message: 'The reply could not be generated. Please try again.',
    });
  });
});

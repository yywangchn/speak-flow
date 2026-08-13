import { TestBed } from '@angular/core/testing';
import { ChatService } from '@speak-flow/chat-data-access';
import { of, Subject, throwError } from 'rxjs';
// The route lazy-loads this feature; the app-level tests need the component directly.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ChatPageComponent } from '@speak-flow/chat-feature';

describe('ChatPageComponent', () => {
  const chatService = {
    sendMessage: vi.fn(),
    streamMessage: vi.fn(),
    loadHistory: vi.fn(),
  };

  beforeEach(async () => {
    chatService.sendMessage.mockReset();
    chatService.streamMessage.mockReset();
    chatService.loadHistory.mockReset();
    chatService.loadHistory.mockReturnValue(of([]));
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
    chatService.streamMessage.mockReturnValue(
      of(
        { type: 'delta', text: 'That sounds good. ' },
        { type: 'delta', text: 'What have you been up to?' },
        { type: 'complete' },
      ),
    );
    const fixture = TestBed.createComponent(ChatPageComponent);
    const component = fixture.componentInstance;
    component.draft.set('I am doing well today.');

    component.onReplyKeydown(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    );

    expect(chatService.streamMessage).toHaveBeenCalledOnce();
    expect(component.messages().at(-2)?.text).toBe('I am doing well today.');
    expect(component.messages().at(-1)?.text).toBe(
      'That sounds good. What have you been up to?',
    );
    expect(component.status()).toEqual({ state: 'idle' });
  });

  it('restores recent messages when the page opens', () => {
    chatService.loadHistory.mockReturnValue(
      of([
        { id: 'saved-1', role: 'user', content: 'Hello again.' },
        { id: 'saved-2', role: 'assistant', content: 'Welcome back!' },
      ]),
    );

    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;

    expect(component.messages()).toEqual([
      { id: 'saved-1', role: 'user', text: 'Hello again.' },
      { id: 'saved-2', role: 'assistant', text: 'Welcome back!' },
    ]);
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
    expect(chatService.streamMessage).not.toHaveBeenCalled();
  });

  it('does not send Enter while an IME composition is active', () => {
    const fixture = TestBed.createComponent(ChatPageComponent);
    const component = fixture.componentInstance;
    component.draft.set('ni hao');
    component.onCompositionStart();

    component.onReplyKeydown(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    );

    expect(chatService.streamMessage).not.toHaveBeenCalled();
    expect(component.status()).toEqual({ state: 'idle' });
    component.onCompositionEnd();
  });

  it('ignores another submission while a reply is pending', () => {
    chatService.streamMessage.mockReturnValue(new Subject());
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;
    component.draft.set('First message');

    component.sendMessage();
    component.draft.set('Second message');
    component.sendMessage();

    expect(chatService.streamMessage).toHaveBeenCalledOnce();
    expect(
      component.messages().filter(({ role }) => role === 'user'),
    ).toHaveLength(1);
  });

  it('shows a recoverable error when the request fails', () => {
    chatService.streamMessage.mockReturnValue(
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

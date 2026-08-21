import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  BrowserVoiceService,
  ChatService,
  CloudSpeechService,
} from '@speak-flow/chat-data-access';
import { of, Subject, throwError } from 'rxjs';
import { provideMarkdown } from 'ngx-markdown';
// The route lazy-loads this feature; the app-level tests need the component directly.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ChatPageComponent } from '@speak-flow/chat-feature';

describe('ChatPageComponent', () => {
  const chatService = {
    sendMessage: vi.fn(),
    streamMessage: vi.fn(),
    loadHistory: vi.fn(),
    logout: vi.fn(),
  };
  const voiceService = {
    recognitionSupported: true,
    playbackEnabled: signal(true),
    listen: vi.fn(),
    stopListening: vi.fn(),
    cancelListening: vi.fn(),
    setPlaybackEnabled: vi.fn((enabled: boolean) =>
      voiceService.playbackEnabled.set(enabled),
    ),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
  };
  const cloudSpeech = {
    preparePlayback: vi.fn(),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
  };

  beforeEach(async () => {
    chatService.sendMessage.mockReset();
    chatService.streamMessage.mockReset();
    chatService.loadHistory.mockReset();
    chatService.logout.mockReset();
    voiceService.playbackEnabled.set(true);
    voiceService.listen.mockReset();
    voiceService.stopListening.mockReset();
    voiceService.cancelListening.mockReset();
    voiceService.setPlaybackEnabled.mockClear();
    voiceService.speak.mockReset();
    voiceService.cancelSpeech.mockReset();
    cloudSpeech.speak.mockReset();
    cloudSpeech.preparePlayback.mockReset();
    cloudSpeech.cancelSpeech.mockReset();
    chatService.loadHistory.mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [ChatPageComponent],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: BrowserVoiceService, useValue: voiceService },
        { provide: CloudSpeechService, useValue: cloudSpeech },
        provideRouter([]),
        provideMarkdown(),
      ],
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
    expect(cloudSpeech.speak).toHaveBeenCalledWith(
      'That sounds good. What have you been up to?',
    );
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
    expect(cloudSpeech.speak).not.toHaveBeenCalled();
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

  it('cancels a streaming reply before sending a new message', () => {
    const firstStream = new Subject<{
      type: 'delta' | 'complete';
      text?: string;
    }>();
    chatService.streamMessage.mockReturnValueOnce(firstStream);
    chatService.streamMessage.mockReturnValueOnce(
      of({ type: 'delta', text: 'New reply.' }, { type: 'complete' }),
    );
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;
    component.draft.set('First message');
    component.sendMessage();
    firstStream.next({ type: 'delta', text: 'Partial reply.' });

    component.draft.set('Second message');
    component.sendMessage();

    expect(firstStream.observed).toBe(false);
    expect(chatService.streamMessage).toHaveBeenCalledTimes(2);
    expect(component.messages().map(({ text }) => text)).toEqual([
      "Hey! It's nice to chat with you. How's your day going?",
      'First message',
      'Partial reply.',
      'Second message',
      'New reply.',
    ]);
    expect(component.status()).toEqual({ state: 'idle' });
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
    expect(cloudSpeech.speak).not.toHaveBeenCalled();
  });

  it('appends a final voice transcript to the existing draft', () => {
    voiceService.listen.mockReturnValue(
      of({ text: 'how are you', isFinal: true }),
    );
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;
    component.draft.set('Hello,');

    component.startVoiceCapture();

    expect(component.draft()).toBe('Hello, how are you');
    expect(component.voiceStatus()).toEqual({ state: 'idle' });
    expect(chatService.streamMessage).not.toHaveBeenCalled();
  });

  it('stops an active recording before processing its result', () => {
    const transcript = new Subject<{ text: string; isFinal: boolean }>();
    voiceService.listen.mockReturnValue(transcript);
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;

    component.startVoiceCapture();
    component.stopVoiceCapture();

    expect(voiceService.stopListening).toHaveBeenCalledOnce();
    expect(component.voiceStatus()).toEqual({ state: 'processing' });
    transcript.next({ text: 'A final transcript', isFinal: true });
    transcript.complete();
    expect(component.draft()).toBe('A final transcript');
    expect(component.voiceStatus()).toEqual({ state: 'idle' });
  });

  it('replaces interim voice text instead of duplicating cumulative results', () => {
    const transcript = new Subject<{ text: string; isFinal: boolean }>();
    voiceService.listen.mockReturnValue(transcript);
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;
    component.draft.set('Before');

    component.startVoiceCapture();
    transcript.next({ text: 'Hello', isFinal: false });
    expect(component.draft()).toBe('Before Hello');
    transcript.next({ text: 'Hello how are you', isFinal: false });
    expect(component.draft()).toBe('Before Hello how are you');
    transcript.next({ text: 'Hello, how are you?', isFinal: true });

    expect(component.draft()).toBe('Before Hello, how are you?');
    expect(chatService.streamMessage).not.toHaveBeenCalled();
  });

  it('shows voice errors without breaking text chat', () => {
    voiceService.listen.mockReturnValue(
      throwError(() => new Error('Microphone access is required.')),
    );
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;

    component.startVoiceCapture();

    expect(component.voiceStatus()).toEqual({
      state: 'error',
      message: 'Microphone access is required.',
    });
    expect(component.status()).toEqual({ state: 'idle' });
  });

  it('toggles playback and stops speech when sending another message', () => {
    chatService.streamMessage.mockReturnValue(
      of({ type: 'delta', text: 'A reply.' }, { type: 'complete' }),
    );
    const component =
      TestBed.createComponent(ChatPageComponent).componentInstance;

    component.togglePlayback();
    component.draft.set('Next message');
    component.sendMessage();

    expect(voiceService.setPlaybackEnabled).toHaveBeenCalledWith(false);
    expect(cloudSpeech.cancelSpeech).toHaveBeenCalled();
  });
});

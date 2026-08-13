import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, toArray } from 'rxjs';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ChatService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ChatService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('returns the reply from the chat endpoint', () => {
    let reply = '';

    service
      .sendMessage([{ role: 'user', content: 'Hello there.' }])
      .subscribe((value) => (reply = value));

    const request = http.expectOne('/api/chat');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      messages: [{ role: 'user', content: 'Hello there.' }],
      userId: expect.any(String),
    });
    request.flush({ reply: '  Hey! How are you?  ' });

    expect(reply).toBe('Hey! How are you?');
  });

  it('loads recent messages for the anonymous user', () => {
    let messages: readonly { id: string; role: string; content: string }[] = [];

    service.loadHistory().subscribe((value) => (messages = value));

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/api/chat/history' &&
        typeof candidate.params.get('userId') === 'string',
    );
    request.flush({
      messages: [
        { id: 'saved-1', role: 'assistant', content: 'Welcome back!' },
      ],
    });

    expect(messages).toHaveLength(1);
  });

  it('rejects an empty reply', () => {
    let error: Error | undefined;

    service
      .sendMessage([{ role: 'user', content: 'Hello there.' }])
      .subscribe({ error: (value: Error) => (error = value) });

    http.expectOne('/api/chat').flush({ reply: '   ' });

    expect(error?.message).toBe('Chat API returned an empty reply.');
  });

  it('passes HTTP errors to the caller', () => {
    let status: number | undefined;

    service.sendMessage([{ role: 'user', content: 'Hello there.' }]).subscribe({
      error: (error: { status: number }) => (status = error.status),
    });

    http.expectOne('/api/chat').flush('Unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    });

    expect(status).toBe(503);
  });

  it('parses streaming events from the chat stream endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '{"type":"delta","text":"Hello"}\n{"type":"complete"}\n',
            { status: 200 },
          ),
        ),
    );

    const events = await firstValueFrom(
      service
        .streamMessage([{ role: 'user', content: 'Hello there.' }])
        .pipe(toArray()),
    );

    expect(events).toEqual([
      { type: 'delta', text: 'Hello' },
      { type: 'complete' },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      '/api/chat/stream',
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });

  it('turns a stream error event into an observable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"type":"error","message":"The reply failed."}\n', {
          status: 200,
        }),
      ),
    );

    await expect(
      firstValueFrom(
        service.streamMessage([{ role: 'user', content: 'Hello there.' }]),
      ),
    ).rejects.toThrow('The reply failed.');
    vi.unstubAllGlobals();
  });
});

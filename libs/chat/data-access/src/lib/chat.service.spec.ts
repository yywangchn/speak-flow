import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
    });
    request.flush({ reply: '  Hey! How are you?  ' });

    expect(reply).toBe('Hey! How are you?');
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
});

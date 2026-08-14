import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ChatStreamEvent } from '@speak-flow/chat-models';
import { map, Observable, timeout } from 'rxjs';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatResponse = {
  reply: string;
};

export type ChatHistoryMessage = ChatMessage & { readonly id: string };

type ChatHistoryResponse = {
  messages: readonly ChatHistoryMessage[];
};

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);

  sendMessage(messages: readonly ChatMessage[]): Observable<string> {
    return this.http.post<ChatResponse>('/api/chat', { messages }).pipe(
      timeout({ first: 35_000 }),
      map(({ reply }) => {
        const text = reply?.trim();
        if (!text) {
          throw new Error('Chat API returned an empty reply.');
        }
        return text;
      }),
    );
  }

  streamMessage(
    messages: readonly ChatMessage[],
    includeFeedback = true,
  ): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((subscriber) => {
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

      void fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, includeFeedback }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            throw new Error('Chat stream could not be started.');
          }
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            buffer += decoder.decode(result.value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              const event = JSON.parse(line) as ChatStreamEvent;
              if (event.type === 'error') {
                throw new Error(event.message);
              }
              subscriber.next(event);
            }
          }
          if (buffer.trim())
            subscriber.next(JSON.parse(buffer) as ChatStreamEvent);
          subscriber.complete();
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) subscriber.error(error);
        });

      return () => {
        controller.abort();
        void reader?.cancel();
      };
    });
  }

  loadHistory(): Observable<readonly ChatHistoryMessage[]> {
    return this.http
      .get<ChatHistoryResponse>('/api/chat/history')
      .pipe(map(({ messages }) => messages));
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', null);
  }
}

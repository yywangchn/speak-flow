import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, timeout } from 'rxjs';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatResponse = {
  reply: string;
};

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);

  sendMessage(messages: readonly ChatMessage[]): Observable<string> {
    return this.http
      .post<ChatResponse>('/api/chat', { messages })
      .pipe(
        timeout({ first: 35_000 }),
        map(({ reply }) => {
          const text = reply?.trim();
          if (!text) {
            throw new Error('Chat API returned an empty reply.');
          }
          return text;
        })
      );
  }
}

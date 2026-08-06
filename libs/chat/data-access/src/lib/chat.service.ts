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

export type ChatHistoryMessage = ChatMessage & { readonly id: string };

type ChatHistoryResponse = {
  messages: readonly ChatHistoryMessage[];
};

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);

  sendMessage(messages: readonly ChatMessage[]): Observable<string> {
    return this.http
      .post<ChatResponse>('/api/chat', { messages, userId: this.getUserId() })
      .pipe(
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

  loadHistory(): Observable<readonly ChatHistoryMessage[]> {
    return this.http
      .get<ChatHistoryResponse>('/api/chat/history', {
        params: { userId: this.getUserId() },
      })
      .pipe(map(({ messages }) => messages));
  }

  private getUserId(): string {
    const storageKey = 'speakflow.userId';
    const existing = globalThis.localStorage?.getItem(storageKey);
    if (existing) return existing;
    const userId = globalThis.crypto.randomUUID();
    globalThis.localStorage?.setItem(storageKey, userId);
    return userId;
  }
}

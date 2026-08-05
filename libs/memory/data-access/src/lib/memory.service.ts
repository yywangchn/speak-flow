import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Memory } from '@speak-flow/memory-models';

@Injectable({ providedIn: 'root' })
export class MemoryService {
  private readonly http = inject(HttpClient);

  list(userId: string): Observable<readonly Memory[]> {
    return this.http.get<readonly Memory[]>('/api/memories', {
      params: { userId },
    });
  }

  remove(userId: string, memoryId: string): Observable<void> {
    return this.http.delete<void>(
      `/api/memories/${encodeURIComponent(memoryId)}`,
      {
        params: { userId },
      },
    );
  }
}

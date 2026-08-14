import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Memory } from '@speak-flow/memory-models';

@Injectable({ providedIn: 'root' })
export class MemoryService {
  private readonly http = inject(HttpClient);

  list(): Observable<readonly Memory[]> {
    return this.http.get<readonly Memory[]>('/api/memories');
  }

  remove(memoryId: string): Observable<void> {
    return this.http.delete<void>(
      `/api/memories/${encodeURIComponent(memoryId)}`,
    );
  }
}

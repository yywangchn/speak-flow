import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';

export type AuthUser = { readonly id: string; readonly email: string };
type AuthResponse = { readonly user: AuthUser };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly user = signal<AuthUser | null>(null);

  checkSession(): Observable<boolean> {
    return this.http.get<AuthResponse>('/api/auth/me').pipe(
      tap(({ user }) => this.user.set(user)),
      map(() => true),
      catchError(() => {
        this.user.set(null);
        return of(false);
      }),
    );
  }

  authenticate(
    mode: 'login' | 'register',
    email: string,
    password: string,
  ): Observable<AuthUser> {
    return this.http
      .post<AuthResponse>(`/api/auth/${mode}`, { email, password })
      .pipe(
        map(({ user }) => user),
        tap((user) => this.user.set(user)),
      );
  }
}

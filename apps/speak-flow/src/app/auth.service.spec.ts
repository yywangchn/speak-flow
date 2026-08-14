import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('restores the authenticated user from the server session', () => {
    let authenticated = false;
    service.checkSession().subscribe((value) => (authenticated = value));

    http.expectOne('/api/auth/me').flush({
      user: { id: 'user-1', email: 'learner@example.com' },
    });

    expect(authenticated).toBe(true);
    expect(service.user()?.email).toBe('learner@example.com');
  });

  it('treats an unauthorized session as signed out', () => {
    service.user.set({ id: 'user-1', email: 'learner@example.com' });
    let authenticated = true;
    service.checkSession().subscribe((value) => (authenticated = value));

    http.expectOne('/api/auth/me').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(authenticated).toBe(false);
    expect(service.user()).toBeNull();
  });

  it('sends credentials to the selected authentication endpoint', () => {
    service
      .authenticate('register', 'learner@example.com', 'password123')
      .subscribe();

    const request = http.expectOne('/api/auth/register');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      email: 'learner@example.com',
      password: 'password123',
    });
    request.flush({ user: { id: 'user-1', email: 'learner@example.com' } });
    expect(service.user()?.id).toBe('user-1');
  });
});

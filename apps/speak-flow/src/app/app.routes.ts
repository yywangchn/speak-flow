import { Route } from '@angular/router';
import { authGuard } from './auth.guard';
import { LoginPageComponent } from './login-page.component';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  { path: 'login', component: LoginPageComponent },
  {
    path: 'chat',
    canActivate: [authGuard],
    loadComponent: () =>
      import('@speak-flow/chat-feature').then(
        ({ ChatPageComponent }) => ChatPageComponent,
      ),
  },
  { path: '**', redirectTo: 'chat' },
];

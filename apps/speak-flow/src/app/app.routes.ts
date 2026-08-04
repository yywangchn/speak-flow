import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  {
    path: 'chat',
    loadComponent: () =>
      import('@speak-flow/chat-feature').then(
        ({ ChatPageComponent }) => ChatPageComponent,
      ),
  },
];

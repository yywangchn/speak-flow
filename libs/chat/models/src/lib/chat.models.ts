export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  readonly id: string;
  readonly role: ChatRole;
  readonly text: string;
};

export type ChatStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'complete' }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'cancelled' };

export type ChatStatus =
  | { readonly state: 'loading' }
  | { readonly state: 'idle' }
  | { readonly state: 'sending' }
  | { readonly state: 'streaming' }
  | { readonly state: 'cancelled' }
  | { readonly state: 'error'; readonly message: string };

export type VoiceCaptureStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'listening' }
  | { readonly state: 'processing' }
  | { readonly state: 'error'; readonly message: string };

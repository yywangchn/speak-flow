export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  readonly id: string;
  readonly role: ChatRole;
  readonly text: string;
};

export type ChatStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'sending' }
  | { readonly state: 'error'; readonly message: string };

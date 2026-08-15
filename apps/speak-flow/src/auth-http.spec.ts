import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { currentUser } from './auth-http';

describe('authentication HTTP handlers', () => {
  it('treats a malformed session cookie as unauthenticated', async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await currentUser(
      { headers: { cookie: 'speakflow_session=%E0%A4%A' } } as Request,
      { status, json } as unknown as Response,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Authentication required.' });
  });
});

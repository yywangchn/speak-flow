import type { NextFunction, Request, Response } from 'express';
import {
  deleteSession,
  findUserBySession,
  loginUser,
  registerUser,
} from './auth-store';

const COOKIE_NAME = 'speakflow_session';

export type AuthenticatedRequest = Request & { userId?: string };

export async function register(req: Request, res: Response): Promise<void> {
  const credentials = getCredentials(req.body);
  if (!credentials) return sendValidationError(res);
  try {
    const session = await registerUser(credentials.email, credentials.password);
    setSessionCookie(res, session.token);
    res.status(201).json({ user: session.user });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'EMAIL_ALREADY_EXISTS') {
      res
        .status(409)
        .json({ error: 'An account with this email already exists.' });
      return;
    }
    throw error;
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const credentials = getCredentials(req.body);
  if (!credentials) return sendValidationError(res);
  const session = await loginUser(credentials.email, credentials.password);
  if (!session) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  setSessionCookie(res, session.token);
  res.json({ user: session.user });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = getSessionToken(req);
  if (token) await deleteSession(token);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
  res.status(204).send();
}

export async function currentUser(req: Request, res: Response): Promise<void> {
  const token = getSessionToken(req);
  const user = token ? await findUserBySession(token) : null;
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  res.json({ user });
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = getSessionToken(req);
  const user = token ? await findUserBySession(token) : null;
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  req.userId = user.id;
  next();
}

function getCredentials(
  value: unknown,
): { email: string; password: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { email, password } = value as { email?: unknown; password?: unknown };
  return typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    typeof password === 'string' &&
    password.length >= 8 &&
    password.length <= 128
    ? { email, password }
    : null;
}

function getSessionToken(req: Request): string | null {
  const cookies = req.headers.cookie?.split(';') ?? [];
  const cookie = cookies.find((item) =>
    item.trim().startsWith(`${COOKIE_NAME}=`),
  );
  if (!cookie) return null;

  try {
    return decodeURIComponent(cookie.trim().slice(COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
}

function setSessionCookie(res: Response, token: string): void {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`,
  );
}

function sendValidationError(res: Response): void {
  res.status(400).json({
    error: 'Enter a valid email and a password of at least 8 characters.',
  });
}

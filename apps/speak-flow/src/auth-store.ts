import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { createPostgresPool } from './database/postgres';

const scrypt = promisify(scryptCallback);
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
let pool: ReturnType<typeof createPostgresPool> | undefined;

export type AuthUser = { readonly id: string; readonly email: string };
export type AuthSession = { readonly user: AuthUser; readonly token: string };

const database = () => (pool ??= createPostgresPool());

export async function registerUser(
  email: string,
  password: string,
): Promise<AuthSession> {
  const passwordHash = await hashPassword(password);
  try {
    const result = await database().query<AuthUser>(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [normalizeEmail(email), passwordHash],
    );
    return createSession(result.rows[0]);
  } catch (error: unknown) {
    if (isPostgresError(error, '23505'))
      throw new Error('EMAIL_ALREADY_EXISTS');
    throw error;
  }
}

export async function loginUser(
  email: string,
  password: string,
): Promise<AuthSession | null> {
  const result = await database().query<AuthUser & { password_hash: string }>(
    'SELECT id, email, password_hash FROM users WHERE email = $1',
    [normalizeEmail(email)],
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash)))
    return null;
  return createSession({ id: user.id, email: user.email });
}

export async function findUserBySession(
  token: string,
): Promise<AuthUser | null> {
  const result = await database().query<AuthUser>(
    `SELECT users.id, users.email
     FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await database().query('DELETE FROM auth_sessions WHERE token_hash = $1', [
    hashToken(token),
  ]);
}

async function createSession(user: AuthUser): Promise<AuthSession> {
  const token = randomBytes(32).toString('base64url');
  await database().query(
    'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), user.id, new Date(Date.now() + SESSION_DURATION_MS)],
  );
  return { user, token };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = (await scrypt(
    password,
    Buffer.from(saltHex, 'hex'),
    expected.length,
  )) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const hashToken = (token: string): string =>
  // Session tokens are high entropy, so a fast one-way hash is appropriate here.
  createHash('sha256').update(token).digest('hex');

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

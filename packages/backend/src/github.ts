/**
 * The three GitHub calls of the App user-authorization flow (research.md section 5): exchange the code,
 * `GET /user`, `GET /user/installations`. The user access token lives only inside `signInWithCode`: it is
 * a local variable, never returned, stored or logged (Requirement 2.2). `fetch` is injected for tests.
 */
import { isRecord } from '@mergescape/shared';
import { GITHUB_LOGIN } from './keys';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GitHubIdentity {
  /** Numeric GitHub user id. */
  id: number;
  login: string;
  /** Installation ids the user can access (`GET /user/installations`). */
  installations: number[];
}

export type SignInFailure = 'rejected' | 'unavailable' | 'not_a_user';

/** The sign-in could not be completed; `reason` says whether GitHub refused or could not be reached. */
export class SignInError extends Error {
  constructor(readonly reason: SignInFailure) {
    super(`GitHub sign-in failed: ${reason}`);
    this.name = 'SignInError';
  }
}

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 3000;
const PAGE_SIZE = 100;
const MAX_INSTALLATION_PAGES = 3;

/** Where the browser is sent to approve the App. The App's configured callback URL receives the code. */
export function authorizeUrl(clientId: string, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('state', state);
  return url.toString();
}

async function request(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      ...init,
      headers: { accept: 'application/json', 'user-agent': 'mergescape', ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SignInError('unavailable');
  }
  if (response.status >= 500) {
    throw new SignInError('unavailable');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SignInError('unavailable');
  }
  if (!response.ok || !isRecord(body)) {
    throw new SignInError('rejected');
  }
  return body;
}

function bearer(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
}

/**
 * Complete the flow for an authorization code: trade it for a user token, read the user and their
 * installations, and return only the numeric id, the login and the installation ids.
 */
export async function signInWithCode(
  fetchFn: FetchLike,
  credentials: { clientId: string; clientSecret: string; code: string },
): Promise<GitHubIdentity> {
  const exchange = await request(fetchFn, TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code: credentials.code,
    }),
  });
  // GitHub answers 200 with an `error` field for a bad or reused code.
  const token = exchange.access_token;
  if (typeof token !== 'string' || token === '') {
    throw new SignInError('rejected');
  }

  const user = await request(fetchFn, `${API}/user`, { method: 'GET', headers: bearer(token) });
  const id = user.id;
  const login = user.login;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || typeof login !== 'string') {
    throw new SignInError('rejected');
  }
  if (user.type !== 'User' || !GITHUB_LOGIN.test(login)) {
    throw new SignInError('not_a_user');
  }

  const installations: number[] = [];
  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page += 1) {
    const body = await request(
      fetchFn,
      `${API}/user/installations?per_page=${PAGE_SIZE}&page=${page}`,
      { method: 'GET', headers: bearer(token) },
    );
    const entries: unknown[] = Array.isArray(body.installations) ? body.installations : [];
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry.id === 'number' && Number.isSafeInteger(entry.id)) {
        installations.push(entry.id);
      }
    }
    if (entries.length < PAGE_SIZE) {
      break;
    }
  }
  return { id, login, installations: [...new Set(installations)] };
}

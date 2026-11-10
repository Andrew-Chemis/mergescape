import { SignJWT } from 'jose';
import type { Config } from '../src/config';
import { Db } from '../src/db';
import type { DocClient } from '../src/db';
import { createApiHandler } from '../src/handlers/api';
import type { FetchLike } from '../src/github';
import type { FunctionUrlEvent, FunctionUrlResult } from '../src/http';
import { JWT_AUDIENCE, JWT_ISSUER, signSessionToken } from '../src/jwt';
import type { Logger } from '../src/log';
import type { SecretName, Secrets } from '../src/secrets';
import { FakeDynamo } from './fake-dynamo';
import { SEED, START } from './harness';
import { TABLE_NAME } from './support';

export const PAGES_ORIGIN = 'https://octo.github.io';
export const JWT_KEY = 'test-jwt-key-0123456789abcdef0123456789abcdef';
export const OAUTH_CLIENT_ID = 'Iv1.testclientid0000';
export const OAUTH_CLIENT_SECRET = 'oauth-client-secret-test-value-0123456789';
/** The user access token the fake GitHub hands out. It must never be stored or logged. */
export const GITHUB_USER_TOKEN = 'gho_THIS_TOKEN_MUST_NEVER_BE_STORED_0123456789';

export const CONFIG: Config = {
  tableName: TABLE_NAME,
  ssmPrefix: '/mergescape',
  pagesOrigin: PAGES_ORIGIN,
  stage: 'test',
  clientBasePath: '/',
};

// ---------------------------------------------------------------------------------------------
// A scripted GitHub
// ---------------------------------------------------------------------------------------------

export interface GitHubCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface GitHubScript {
  exchange?: () => Response | Promise<Response>;
  user?: () => Response | Promise<Response>;
  installations?: () => Response | Promise<Response>;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function fakeGitHub(script: GitHubScript = {}): { fetch: FetchLike; calls: GitHubCall[] } {
  const calls: GitHubCall[] = [];
  const fetchFn: FetchLike = (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (url === 'https://github.com/login/oauth/access_token') {
      return Promise.resolve(
        script.exchange?.() ??
          jsonResponse({ access_token: GITHUB_USER_TOKEN, token_type: 'bearer', scope: '' }),
      );
    }
    if (url === 'https://api.github.com/user') {
      return Promise.resolve(
        script.user?.() ?? jsonResponse({ id: 1001001, login: 'Octo-Cat', type: 'User' }),
      );
    }
    if (url.startsWith('https://api.github.com/user/installations')) {
      return Promise.resolve(
        script.installations?.() ??
          jsonResponse({
            total_count: 2,
            installations: [
              { id: 777001, account: { id: 5005005 } },
              { id: 777002, account: { id: 6006006 } },
            ],
          }),
      );
    }
    return Promise.reject(new Error(`unexpected request to ${url}`));
  };
  return { fetch: fetchFn, calls };
}

// ---------------------------------------------------------------------------------------------
// The api handler over an in-memory table
// ---------------------------------------------------------------------------------------------

export interface ApiHarness {
  fake: FakeDynamo;
  db: Db;
  logs: string[];
  clock: { now: number };
  github: ReturnType<typeof fakeGitHub>;
  handler: ReturnType<typeof createApiHandler>;
  /** A valid session token for `userId`, issued now. */
  token(userId?: number): Promise<string>;
}

export function makeApiHarness(script: GitHubScript = {}): ApiHarness {
  const fake = new FakeDynamo({ tableName: TABLE_NAME });
  const db = new Db(fake as unknown as DocClient, TABLE_NAME);
  const logs: string[] = [];
  const log: Logger = {
    error(event, context, error) {
      logs.push(
        JSON.stringify({
          event,
          ...context,
          error: error instanceof Error ? error.name : undefined,
        }),
      );
    },
  };
  const values: Record<SecretName, string> = {
    'github-webhook-secret': 'unused',
    'github-oauth-client-secret': OAUTH_CLIENT_SECRET,
    'github-oauth-client-id': OAUTH_CLIENT_ID,
    'jwt-key': JWT_KEY,
    'github-app-private-key': 'unused',
  };
  const secrets: Secrets = { get: (name) => Promise.resolve(values[name]) };
  const clock = { now: START };
  const github = fakeGitHub(script);
  const handler = createApiHandler({
    db,
    secrets,
    config: CONFIG,
    log,
    now: () => clock.now,
    fetch: github.fetch,
    newSeed: () => SEED,
  });
  return {
    fake,
    db,
    logs,
    clock,
    github,
    handler,
    token: (userId = 1001001) => signSessionToken(JWT_KEY, userId, clock.now),
  };
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export interface RequestOptions {
  method?: string;
  path: string;
  query?: Record<string, string>;
  /** `undefined` sends the Pages origin, `null` sends no Origin header. */
  origin?: string | null;
  token?: string | null;
  headers?: Record<string, string>;
  /** Cookies the browser sends, as Function URLs list them (`name=value`). */
  cookies?: readonly string[];
}

export function apiRequest(options: RequestOptions): FunctionUrlEvent {
  const headers: Record<string, string> = { ...options.headers };
  const origin = options.origin === undefined ? PAGES_ORIGIN : options.origin;
  if (origin !== null) {
    headers.origin = origin;
  }
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const query = options.query ?? {};
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: options.path,
    rawQueryString: new URLSearchParams(query).toString(),
    headers,
    queryStringParameters: Object.keys(query).length > 0 ? query : undefined,
    ...(options.cookies ? { cookies: [...options.cookies] } : {}),
    requestContext: {
      accountId: 'anonymous',
      apiId: 'test',
      domainName: 'test.lambda-url.us-east-1.on.aws',
      domainPrefix: 'test',
      http: {
        method: options.method ?? 'GET',
        path: options.path,
        protocol: 'HTTP/1.1',
        sourceIp: '192.0.2.1',
        userAgent: 'test',
      },
      requestId: 'request-1',
      routeKey: '$default',
      stage: '$default',
      time: '09/Nov/2026:12:00:00 +0000',
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  };
}

/** A token signed with the right key but with claims overridden, for the verification-failure tests. */
export async function forgeToken(
  claims: { iss?: string; aud?: string; sub?: string; iat?: number; exp?: number; alg?: string },
  key = JWT_KEY,
): Promise<string> {
  const iat = claims.iat ?? START / 1000;
  return new SignJWT({})
    .setProtectedHeader({ alg: claims.alg ?? 'HS256' })
    .setSubject(claims.sub ?? '1001001')
    .setIssuer(claims.iss ?? JWT_ISSUER)
    .setAudience(claims.aud ?? JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(claims.exp ?? iat + 3600)
    .sign(new TextEncoder().encode(key));
}

/** Pull the `state` out of the login redirect. */
export function stateOf(location: string | undefined): string {
  return new URL(location ?? '').searchParams.get('state') ?? '';
}

/** What the login redirect issued: the state in the GitHub URL, and the cookies the browser sends back with it. */
export interface Login {
  state: string;
  cookies: string[];
}

export function loginOf(result: FunctionUrlResult): Login {
  return {
    state: stateOf(String(result.headers?.location)),
    cookies: (result.cookies ?? []).map((cookie) => cookie.split(';')[0] ?? ''),
  };
}

/** The fragment of a redirect back to the client. */
export function fragmentOf(location: string | undefined): string {
  return new URL(location ?? '').hash;
}

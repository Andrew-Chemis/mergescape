/**
 * Secrets from SSM Parameter Store (Requirement 12.5): read at cold start, cached for 15 minutes so a
 * rotation needs no redeploy. The SSM client is injected, so tests never call AWS.
 */
import { GetParameterCommand } from '@aws-sdk/client-ssm';
import type { GetParameterCommandOutput } from '@aws-sdk/client-ssm';
import type { Logger } from './log';

export type SecretName =
  | 'github-webhook-secret'
  | 'github-oauth-client-secret'
  | 'github-oauth-client-id'
  | 'jwt-key'
  | 'github-app-private-key';

export interface Secrets {
  get(name: SecretName): Promise<string>;
}

/** The part of `SSMClient` used here. */
export interface SsmLike {
  send(command: GetParameterCommand): Promise<GetParameterCommandOutput>;
}

export const SECRET_CACHE_MS = 15 * 60 * 1000;

export class SecretUnavailableError extends Error {
  constructor() {
    super('A required secret is not available');
    this.name = 'SecretUnavailableError';
  }
}

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

export function createSecrets(options: {
  ssm: SsmLike;
  prefix: string;
  now?: () => number;
  cacheMs?: number;
  log?: Logger;
}): Secrets {
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? SECRET_CACHE_MS;
  const cache = new Map<SecretName, CacheEntry>();
  const inFlight = new Map<SecretName, Promise<string>>();

  async function fetchSecret(name: SecretName): Promise<string> {
    const output = await options.ssm.send(
      new GetParameterCommand({ Name: `${options.prefix}/${name}`, WithDecryption: true }),
    );
    const value = output.Parameter?.Value;
    if (value === undefined || value === '') {
      throw new SecretUnavailableError();
    }
    cache.set(name, { value, fetchedAt: now() });
    return value;
  }

  return {
    async get(name) {
      const cached = cache.get(name);
      if (cached && now() - cached.fetchedAt < cacheMs) {
        return cached.value;
      }
      const pending = inFlight.get(name);
      if (pending) {
        return pending;
      }
      const request = fetchSecret(name)
        .catch((error: unknown) => {
          // Keep serving the previous value through a transient SSM failure.
          if (cached) {
            options.log?.error('secrets.refresh_failed', {}, error);
            return cached.value;
          }
          throw error;
        })
        .finally(() => {
          inFlight.delete(name);
        });
      inFlight.set(name, request);
      return request;
    },
  };
}

/** Environment configuration shared by both Lambdas (the CDK stack, packages/infra/lib/mergescape-stack.ts, sets the names). */

export interface Config {
  tableName: string;
  /** SSM prefix under which the secrets live, for example `/mergescape`. */
  ssmPrefix: string;
  /** Origin of the GitHub Pages client: scheme and host only. Used for the Origin check and redirects. */
  pagesOrigin: string;
  stage: string;
  /** Path of the client on its origin (`/` for a user site, `/mergescape/` for a project site). */
  clientBasePath: string;
}

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

/** Reads and validates the configuration. Throws on a missing or malformed value. */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  const pagesOrigin = required(env, 'PAGES_ORIGIN');
  if (new URL(pagesOrigin).origin !== pagesOrigin || !pagesOrigin.startsWith('https://')) {
    throw new Error('PAGES_ORIGIN must be an https origin with no path or trailing slash');
  }
  const ssmPrefix = required(env, 'SSM_PREFIX');
  if (!ssmPrefix.startsWith('/') || ssmPrefix.endsWith('/')) {
    throw new Error('SSM_PREFIX must start with a slash and not end with one');
  }
  const base = env.CLIENT_BASE_PATH ?? '/';
  if (!/^\/([A-Za-z0-9._~-]+\/)*$/.test(base)) {
    throw new Error('CLIENT_BASE_PATH must start and end with a slash');
  }
  return {
    tableName: required(env, 'TABLE_NAME'),
    ssmPrefix,
    pagesOrigin,
    stage: env.STAGE ?? 'prod',
    clientBasePath: base,
  };
}

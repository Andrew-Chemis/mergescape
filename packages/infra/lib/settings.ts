/**
 * Settings of the stack, read from CDK context: defaults live in `cdk.json`, `-c key=value` overrides them
 * (that is how `deploy.yml` passes the repository variables). Each value is checked against the same
 * pattern the SAM template's parameters had, so a typo fails at synth time instead of at deploy time.
 */

/** The only region the landing zone declares the account for (its bootstrap StackSet covers it). */
export const DEFAULT_REGION = 'us-east-1';

/** What `cdk.json` ships so that `cdk synth` and the tests work with no `-c`. Never deployed: see `readSettings`. */
export const PLACEHOLDER_PAGES_ORIGIN = 'https://example.github.io';
export const PLACEHOLDER_ALERT_EMAIL = 'alerts@example.com';

export interface Settings {
  /** Origin of the GitHub Pages site that hosts the client: scheme and host only. CORS and the Origin check. */
  readonly pagesOrigin: string;
  /** Path of the client on its Pages origin, leading and trailing slash: `/` or `/<repository>/`. */
  readonly clientBasePath: string;
  /** SSM Parameter Store prefix of the five SecureString parameters. */
  readonly ssmPrefix: string;
  /** Appears in resource names and in the STAGE environment variable. */
  readonly stage: string;
  /** Receives the AWS Budgets e-mail alerts. */
  readonly alertEmail: string;
  /** The AWS account the app is vended; unset means an environment-agnostic stack that is only synthesized. */
  readonly accountId: string | undefined;
  readonly region: string;
}

const PATTERNS = {
  pagesOrigin: [
    /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/,
    'an https origin with no path and no trailing slash',
  ],
  clientBasePath: [
    /^\/([A-Za-z0-9._~-]+\/)*$/,
    'starts and ends with a slash, for example / or /mergescape/',
  ],
  ssmPrefix: [
    /^\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/,
    'starts with a slash and does not end with one',
  ],
  stage: [/^[a-z][a-z0-9-]{0,15}$/, 'lowercase letters, digits and hyphens, at most 16 characters'],
  alertEmail: [/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'an e-mail address'],
  accountId: [/^[0-9]{12}$/, 'a 12-digit AWS account id'],
  region: [/^[a-z]{2}(-[a-z]+)+-[0-9]$/, 'an AWS region such as us-east-1'],
} as const satisfies Record<string, readonly [RegExp, string]>;

type SettingName = keyof typeof PATTERNS;

/** `-c key=value` arrives as a string, and a variable that is unset in CI as an empty one. */
function read(
  get: (key: string) => unknown,
  name: SettingName,
  fallback: string | undefined,
): string | undefined {
  const raw: unknown = get(name);
  const value = raw === undefined || raw === null || raw === '' ? fallback : raw;
  if (value === undefined) return undefined;
  const [pattern, expected] = PATTERNS[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`context ${name}=${JSON.stringify(value)} is invalid: expected ${expected}`);
  }
  return value;
}

/**
 * Reads and validates the context. `get` is `app.node.tryGetContext`, or a plain lookup in tests.
 *
 * When `accountId` is set the stack is going to be deployed, so the placeholder origin and e-mail address
 * that `cdk.json` ships for synth-only runs are refused: a deploy that forgot `-c pagesOrigin=...` would
 * otherwise lock CORS to a site that is not yours and send the budget alerts nowhere.
 */
export function readSettings(get: (key: string) => unknown): Settings {
  const required = (name: SettingName, fallback?: string): string => {
    const value = read(get, name, fallback);
    if (value === undefined) throw new Error(`context ${name} is required`);
    return value;
  };
  const settings: Settings = {
    pagesOrigin: required('pagesOrigin', PLACEHOLDER_PAGES_ORIGIN),
    clientBasePath: required('clientBasePath', '/'),
    ssmPrefix: required('ssmPrefix', '/mergescape'),
    stage: required('stage', 'prod'),
    alertEmail: required('alertEmail', PLACEHOLDER_ALERT_EMAIL),
    accountId: read(get, 'accountId', undefined),
    region: required('region', DEFAULT_REGION),
  };
  if (settings.accountId !== undefined) {
    if (settings.pagesOrigin === PLACEHOLDER_PAGES_ORIGIN) {
      throw new Error(
        'context pagesOrigin is the placeholder: pass -c pagesOrigin=https://<owner>.github.io',
      );
    }
    if (settings.alertEmail === PLACEHOLDER_ALERT_EMAIL) {
      throw new Error('context alertEmail is the placeholder: pass -c alertEmail=<your address>');
    }
  }
  return settings;
}

/** `mergescape` for production, `mergescape-<stage>` otherwise: the stack name and the table name. */
export const baseNameFor = (stage: string): string =>
  stage === 'prod' ? 'mergescape' : `mergescape-${stage}`;

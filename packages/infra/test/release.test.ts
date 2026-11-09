/**
 * Task 19: the release-readiness facts that span packages, kept honest by tests. The App manifest matches
 * Requirement 1.1, the README links what Requirement 18.4 asks for and describes the setup the code and the
 * workflows actually have, and CI enforces the coverage thresholds of Requirement 4.10.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import coverageConfig from '../../../vitest.config';

const root = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(root(path), 'utf8');

const requirements = read('.kiro/specs/mergescape/requirements.md');
const readme = read('README.md');
const deploy = read('.github/workflows/deploy.yml');
const ci = read('.github/workflows/ci.yml');

interface Manifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  callback_urls: string[];
  public: boolean;
  request_oauth_on_install: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
}

const manifest = JSON.parse(read('docs/github-app-manifest.json')) as Manifest;

/** The backticked words of a sentence of Requirement 1.1. */
function quoted(sentence: string): string[] {
  return [...sentence.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
}

describe('docs/github-app-manifest.json (Requirement 1.1)', () => {
  const criterion = /^1\. THE GitHub App SHALL request (.*)$/m.exec(requirements)?.[1] ?? '';

  it('requests exactly Pull requests: Read and Metadata: Read, and nothing that can write', () => {
    expect(criterion).toContain('`Pull requests: Read` and `Metadata: Read`');
    expect(manifest.default_permissions).toEqual({ pull_requests: 'read', metadata: 'read' });
    expect(Object.values(manifest.default_permissions).every((level) => level === 'read')).toBe(
      true,
    );
  });

  it('subscribes to the three pull request events; GitHub adds the two installation events itself', () => {
    const [, eventList = ''] = criterion.split('subscribe to exactly the events');
    const specified = quoted(eventList);
    expect(specified).toHaveLength(5);
    expect(manifest.default_events).toEqual([
      'pull_request',
      'pull_request_review',
      'pull_request_review_comment',
    ]);
    // Every event the requirement names is either subscribed to here or one GitHub always sends an App.
    expect(
      [...manifest.default_events, 'installation', 'installation_repositories'].sort(),
    ).toEqual([...specified].sort());
  });

  it('points the webhook at the ingest URL and the callback at the api URL plus /auth/callback', () => {
    expect(manifest.hook_attributes.active).toBe(true);
    expect(manifest.hook_attributes.url).toMatch(/^https:\/\/\S+\.lambda-url\.\S+\.on\.aws\/$/);
    expect(manifest.callback_urls).toHaveLength(1);
    expect(manifest.callback_urls[0]).toMatch(
      /^https:\/\/\S+\.lambda-url\.\S+\.on\.aws\/auth\/callback$/,
    );
    // The api's route and the template outputs those URLs come from.
    expect(read('packages/backend/src/handlers/api.ts')).toContain("path === '/auth/callback'");
    const template = read('packages/infra/template.yaml');
    expect(template).toMatch(/^ {2}IngestUrl:\n {4}Description:.*webhook URL/m);
    expect(template).toMatch(/^ {2}ApiUrl:\n/m);
  });

  it('is a public App that does not ask for OAuth on install, with only fields GitHub knows', () => {
    expect(manifest.public).toBe(true);
    expect(manifest.request_oauth_on_install).toBe(false);
    expect(Object.keys(manifest).sort()).toEqual(
      [
        'callback_urls',
        'default_events',
        'default_permissions',
        'description',
        'hook_attributes',
        'name',
        'public',
        'request_oauth_on_install',
        'url',
      ].sort(),
    );
  });
});

describe('README.md (Requirement 18.4 and the self-hosting guide)', () => {
  it('links the manifest, the scorer, Privacy and Terms, and every relative link resolves', () => {
    for (const target of [
      'docs/github-app-manifest.json',
      'packages/shared/src/score.ts',
      'packages/client/src/routes/Privacy.svelte',
      'packages/client/src/routes/Terms.svelte',
    ]) {
      expect(readme).toContain(`](${target})`);
    }
    expect(readme).toContain('`#/privacy`');
    expect(readme).toContain('`#/terms`');
    const links = [...readme.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/g)].map(
      (match) => match[1] ?? '',
    );
    expect(links.length).toBeGreaterThan(8);
    for (const link of links) {
      expect(existsSync(root(link.split('#')[0] ?? '')), `${link} does not exist`).toBe(true);
    }
  });

  it('serves the routes it names', () => {
    const router = read('packages/client/src/router.ts');
    expect(router).toContain("case '/privacy':");
    expect(router).toContain("case '/terms':");
  });

  it('states the permission list: two permissions, five events', () => {
    expect(readme).toContain('exactly **two permissions** and receives exactly **five events**');
    for (const name of [
      'Pull requests',
      'Metadata',
      'pull_request',
      'pull_request_review',
      'pull_request_review_comment',
      'installation',
      'installation_repositories',
    ]) {
      expect(readme).toContain(name);
    }
  });

  it('tells you to create exactly the five SSM parameters the backend reads', () => {
    const secrets = read('packages/backend/src/secrets.ts');
    const union = /export type SecretName =([^;]*);/.exec(secrets)?.[1] ?? '';
    const names = [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] ?? '').sort();
    expect(names).toHaveLength(5);
    const created = [
      ...readme.matchAll(/aws ssm put-parameter --type SecureString --name \$P\/([a-z-]+)/g),
    ].map((match) => match[1] ?? '');
    expect(created.sort()).toEqual(names);
    // The infra README, which has the longer notes, lists the same five.
    const infra = read('packages/infra/README.md');
    for (const name of names) {
      expect(infra).toContain(`${name}`);
    }
  });

  it('names only repository variables the deploy workflow reads', () => {
    const section = /5\. \*\*Set repository variables\*\*(.*)/.exec(readme)?.[1] ?? '';
    const variables = [...section.matchAll(/`([A-Z][A-Z_]+)`/g)].map((match) => match[1] ?? '');
    expect(variables.length).toBeGreaterThanOrEqual(7);
    for (const variable of variables) {
      expect(deploy, `${variable} is not read by deploy.yml`).toContain(`vars.${variable}`);
    }
  });

  it('describes the budget alarms the template creates', () => {
    const template = read('packages/infra/template.yaml');
    expect(readme).toContain('**1 USD** and **10 USD**');
    expect(template).toMatch(/Amount: 1\n/);
    expect(template).toMatch(/Amount: 10\n/);
    expect(readme).toContain('reserved concurrency (10 for `ingest`, 5 for `api`)');
    expect(template).toContain('ReservedConcurrentExecutions: 10');
    expect(template).toContain('ReservedConcurrentExecutions: 5');
  });

  it('documents the thresholds CI enforces', () => {
    expect(readme).toContain(
      '`shared` 95 % (and 100 % branches on `score.ts`), `backend` 90 %, `client` 90 %',
    );
  });
});

describe('coverage thresholds (Requirement 4.10 and 18.2)', () => {
  const coverage = coverageConfig.test?.coverage;
  const thresholds = (coverage?.thresholds ?? {}) as Record<
    string,
    { lines?: number; branches?: number }
  >;

  it('are set per package at or above the required floors', () => {
    expect(thresholds['packages/shared/src/**']?.lines).toBeGreaterThanOrEqual(95);
    expect(thresholds['packages/shared/src/score.ts']?.branches).toBe(100);
    expect(thresholds['packages/backend/src/**']?.lines).toBeGreaterThanOrEqual(85);
    expect(thresholds['packages/client/src/**']?.lines).toBeGreaterThanOrEqual(80);
  });

  it('cover the product code of every package and not the tests', () => {
    expect(coverage?.include).toEqual(
      expect.arrayContaining(['packages/shared/src/**/*.ts', 'packages/backend/src/**/*.ts']),
    );
    expect(coverage?.include?.some((pattern) => pattern.startsWith('packages/client/src/'))).toBe(
      true,
    );
    expect(coverage?.exclude).toContain('**/*.test.ts');
  });

  it('are enforced by `pnpm test`, which CI runs on every pull request', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts['test']).toContain('--coverage');
    expect(ci).toMatch(/pull_request:/);
    for (const step of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build']) {
      expect(ci).toMatch(new RegExp(`- run: ${step}$`, 'm'));
    }
  });

  it('are joined in CI by the template checks and the dependency audit', () => {
    expect(ci).toContain('cfn-lint packages/infra/template.yaml');
    expect(ci).toContain('checkov --config-file packages/infra/.checkov.yaml');
    expect(ci).toContain('pnpm audit --prod');
  });
});

describe('docs/decisions.md', () => {
  const decisions = read('docs/decisions.md');

  it('records that SAM was kept over CDK, and why', () => {
    const section =
      /## Infrastructure: AWS SAM, kept over CDK([\s\S]*?)\n## /.exec(decisions)?.[1] ?? '';
    expect(section).toContain('SAM stays');
    expect(section).toContain('CDK');
    for (const reason of ['Two functions and one table', 'locally', 'No bootstrap stack']) {
      expect(section, `missing the reason "${reason}"`).toContain(reason);
    }
  });
});

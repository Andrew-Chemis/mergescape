/**
 * Task 25: the stack's context (cdk.json defaults, `-c` overrides) and the way the app deploys: into the
 * account the landing zone vends, in us-east-1, through the landing zone's CDK bootstrap roles, with no
 * lookups so that synthesis needs no AWS credentials.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Token } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGION,
  PLACEHOLDER_ALERT_EMAIL,
  PLACEHOLDER_PAGES_ORIGIN,
  baseNameFor,
  readSettings,
} from '../lib/settings';
import { CDK_JSON, DEPLOY_CONTEXT, TEST_ACCOUNT, synth } from './synth';
import type { TemplateJson } from './synth';

const lookup = (context: Record<string, unknown>) => (key: string) => context[key];

describe('cdk.json', () => {
  it('runs bin/mergescape.ts and writes the synthesized app under dist/', () => {
    expect(CDK_JSON.app).toContain('bin/mergescape.ts');
    expect(existsSync(fileURLToPath(new URL('../bin/mergescape.ts', import.meta.url)))).toBe(true);
    expect(CDK_JSON.output).toBe('dist/cdk.out');
  });

  it('defaults to the landing zone primary region and the production stage', () => {
    expect(CDK_JSON.context['region']).toBe('us-east-1');
    expect(DEFAULT_REGION).toBe('us-east-1');
    expect(CDK_JSON.context['stage']).toBe('prod');
    expect(CDK_JSON.context['ssmPrefix']).toBe('/mergescape');
    expect(CDK_JSON.context['clientBasePath']).toBe('/');
  });

  it('ships the placeholder origin and e-mail address, and no account', () => {
    expect(CDK_JSON.context['pagesOrigin']).toBe(PLACEHOLDER_PAGES_ORIGIN);
    expect(CDK_JSON.context['alertEmail']).toBe(PLACEHOLDER_ALERT_EMAIL);
    expect(CDK_JSON.context['accountId']).toBe('');
  });

  it('settings read from it are valid', () => {
    expect(readSettings(lookup(CDK_JSON.context))).toEqual({
      pagesOrigin: PLACEHOLDER_PAGES_ORIGIN,
      clientBasePath: '/',
      ssmPrefix: '/mergescape',
      stage: 'prod',
      alertEmail: PLACEHOLDER_ALERT_EMAIL,
      accountId: undefined,
      region: 'us-east-1',
    });
  });
});

describe('readSettings', () => {
  const valid = { ...CDK_JSON.context, ...DEPLOY_CONTEXT };

  it('takes overrides', () => {
    const settings = readSettings(
      lookup({
        ...valid,
        stage: 'staging',
        region: 'us-west-2',
        ssmPrefix: '/ms/staging',
        clientBasePath: '/mergescape/',
      }),
    );
    expect(settings).toMatchObject({
      pagesOrigin: 'https://octocat.github.io',
      alertEmail: 'octocat@example.org',
      accountId: TEST_ACCOUNT,
      stage: 'staging',
      region: 'us-west-2',
      ssmPrefix: '/ms/staging',
      clientBasePath: '/mergescape/',
    });
  });

  it('treats an empty value, which an unset repository variable gives, as unset', () => {
    const settings = readSettings(
      lookup({ ...valid, accountId: '', clientBasePath: '', stage: '' }),
    );
    expect(settings).toMatchObject({ accountId: undefined, clientBasePath: '/', stage: 'prod' });
  });

  it.each([
    ['pagesOrigin', 'http://octocat.github.io'],
    ['pagesOrigin', 'https://octocat.github.io/'],
    ['pagesOrigin', 'https://octocat.github.io/mergescape'],
    ['pagesOrigin', 'https://Andrew-Chemis.github.io'],
    ['clientBasePath', 'mergescape/'],
    ['clientBasePath', '/mergescape'],
    ['ssmPrefix', 'mergescape'],
    ['ssmPrefix', '/mergescape/'],
    ['stage', 'Prod'],
    ['stage', 'a-stage-name-that-is-far-too-long'],
    ['alertEmail', 'not-an-address'],
    ['accountId', '1234'],
    ['accountId', 'abcdefghijkl'],
    ['region', 'west'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => readSettings(lookup({ ...valid, [name]: value }))).toThrow(
      new RegExp(`context ${name}=`),
    );
  });

  it('asks for a lowercase origin: the Lambdas compare it with new URL(x).origin and throw on a mismatch', () => {
    const mixed = 'https://Andrew-Chemis.github.io';
    // This is exactly the comparison loadConfig makes at cold start; the settings must never let it fail.
    expect(new URL(mixed).origin).not.toBe(mixed);
    expect(() => readSettings(lookup({ ...valid, pagesOrigin: mixed }))).toThrow(/lowercase/);
    const lower = mixed.toLowerCase();
    expect(new URL(lower).origin).toBe(lower);
    expect(readSettings(lookup({ ...valid, pagesOrigin: lower })).pagesOrigin).toBe(lower);
  });

  it('refuses the shipped placeholders once an account is set, because that is a deploy', () => {
    expect(() => readSettings(lookup({ ...valid, pagesOrigin: PLACEHOLDER_PAGES_ORIGIN }))).toThrow(
      /pagesOrigin is the placeholder/,
    );
    expect(() => readSettings(lookup({ ...valid, alertEmail: PLACEHOLDER_ALERT_EMAIL }))).toThrow(
      /alertEmail is the placeholder/,
    );
    // Without an account they are fine: that is `cdk synth` and CI.
    expect(() =>
      readSettings(lookup({ ...valid, accountId: '', pagesOrigin: PLACEHOLDER_PAGES_ORIGIN })),
    ).not.toThrow();
  });

  it('names the stack and table mergescape for prod and mergescape-<stage> otherwise', () => {
    expect(baseNameFor('prod')).toBe('mergescape');
    expect(baseNameFor('staging')).toBe('mergescape-staging');
  });
});

describe('what the context changes in the template', () => {
  it('a project site: PAGES_ORIGIN, CLIENT_BASE_PATH, the CORS origin and the SSM ARNs follow the context', () => {
    const { template } = synth({
      ...DEPLOY_CONTEXT,
      pagesOrigin: 'https://example-owner.github.io',
      clientBasePath: '/mergescape/',
      ssmPrefix: '/ms/one',
    });
    const json = template.toJSON() as TemplateJson;
    const text = JSON.stringify(json);
    expect(text.match(/"PAGES_ORIGIN":"https:\/\/example-owner.github.io"/g)).toHaveLength(2);
    expect(text.match(/"CLIENT_BASE_PATH":"\/mergescape\/"/g)).toHaveLength(2);
    expect(text.match(/"SSM_PREFIX":"\/ms\/one"/g)).toHaveLength(2);
    expect(text).toContain('"AllowOrigins":["https://example-owner.github.io"]');
    expect(
      text.match(new RegExp(`arn:aws:ssm:us-east-1:${TEST_ACCOUNT}:parameter/ms/one/\\*`, 'g')),
    ).toHaveLength(2);
    expect(text).not.toContain('octocat.github.io');
  });

  it('a non-production stage is named after it and keeps its own table', () => {
    const { template } = synth({ ...DEPLOY_CONTEXT, stage: 'staging' });
    const text = JSON.stringify(template.toJSON());
    expect(text).toContain('"TableName":"mergescape-staging"');
    expect(text).toContain('"FunctionName":"mergescape-staging-ingest"');
    expect(text).toContain('"FunctionName":"mergescape-staging-api"');
    expect(text).toContain('"/aws/lambda/mergescape-staging-api"');
    expect(text).toContain('"BudgetName":"mergescape-staging-monthly-1-usd"');
    expect(text).toContain('"Comment":"Mergescape staging badges"');
    expect(text).toContain('"STAGE":"staging"');
  });

  it('every name that must be unique per account carries the stage, so two stages can share an account', () => {
    const names = (stage: string): string[] => {
      const text = JSON.stringify(synth({ ...DEPLOY_CONTEXT, stage }).template.toJSON());
      return [
        ...text.matchAll(/"(?:TableName|FunctionName|LogGroupName|BudgetName|Name)":"([^"]+)"/g),
      ].map((match) => match[1] ?? '');
    };
    const prod = names('prod');
    const staging = names('staging');
    expect(prod.length).toBeGreaterThanOrEqual(9);
    expect(prod.filter((name) => staging.includes(name))).toEqual([]);
  });
});

describe('deploying through the landing zone', () => {
  it('targets the vended account in us-east-1 with the CDK bootstrap roles of qualifier hnb659fds', () => {
    const { app } = synth();
    const stack = app.synth().getStackByName('mergescape');
    expect(stack.environment).toMatchObject({ account: TEST_ACCOUNT, region: 'us-east-1' });
    expect(stack.assumeRoleArn).toBe(
      `arn:\${AWS::Partition}:iam::${TEST_ACCOUNT}:role/cdk-hnb659fds-deploy-role-${TEST_ACCOUNT}-us-east-1`,
    );
    expect(stack.cloudFormationExecutionRoleArn).toBe(
      `arn:\${AWS::Partition}:iam::${TEST_ACCOUNT}:role/cdk-hnb659fds-cfn-exec-role-${TEST_ACCOUNT}-us-east-1`,
    );
  });

  it('takes the region from the context', () => {
    const { app } = synth({ ...DEPLOY_CONTEXT, region: 'us-west-2' });
    expect(app.synth().getStackByName('mergescape').environment.region).toBe('us-west-2');
  });

  it('synthesizes with no account and no context at all, and asks AWS for nothing', () => {
    const { app, stack } = synth({});
    const assembly = app.synth();
    // A lookup (VPC, AMI, hosted zone, SSM parameter) would leave an entry in `missing`.
    expect(assembly.manifest.missing ?? []).toEqual([]);
    expect(assembly.getStackByName('mergescape').environment).toMatchObject({
      account: 'unknown-account',
      region: 'us-east-1',
    });
    expect(Token.isUnresolved(stack.account)).toBe(true);
    expect(stack.region).toBe('us-east-1');
  });

  it('is one stack, with the retained table the only thing a failed deploy cannot take away', () => {
    const { app } = synth();
    expect(app.synth().stacksRecursively.map((s) => s.stackName)).toEqual(['mergescape']);
  });
});

/**
 * Task 25: the CDK stack produces the resources and the IAM the SAM template had (Requirement 12). These are
 * the assertions of the old `scripts/validate.mjs`, now made on the synthesized CloudFormation, plus a
 * snapshot of the whole template under `__snapshots__/`.
 *
 * The stack is synthesized for a made-up account (so ARNs resolve to literals) and with esbuild switched off
 * (the asset hash is then a placeholder that does not change with the backend's source; `bundling.test.ts`
 * runs esbuild for real).
 */
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';
import { GSI1_PROJECTED_ATTRIBUTES as FAKE_GSI1_PROJECTION } from '../../backend/test/fake-dynamo';
import { synth, TEST_ACCOUNT } from './synth';
import type { Json, TemplateJson, TemplateResource } from './synth';

const SNAPSHOT = fileURLToPath(
  new URL('./__snapshots__/mergescape.template.json', import.meta.url),
);

const { template } = synth();
const json = template.toJSON() as TemplateJson;
const resources = json.Resources;

// --- Lookup helpers ----------------------------------------------------------------------------

const entriesOfType = (type: string): [string, TemplateResource][] =>
  Object.entries(resources).filter(([, resource]) => resource.Type === type);

const only = (type: string): [string, TemplateResource] => {
  const found = entriesOfType(type);
  expect(found, `exactly one ${type}`).toHaveLength(1);
  return found[0] as [string, TemplateResource];
};

const props = (resource: TemplateResource | undefined): Json => resource?.Properties ?? {};
const sorted = (list: readonly string[]): string[] => [...list].sort();
const getAtt = (id: string, attribute: string) => ({ 'Fn::GetAtt': [id, attribute] });

type FunctionName = 'ingest' | 'api';

/** The Lambda function, its role, its one inline policy and its log group, found by name. */
function lambdaOf(name: FunctionName) {
  const [id, fn] = entriesOfType('AWS::Lambda::Function').find(
    ([, resource]) => props(resource)['FunctionName'] === `mergescape-prod-${name}`,
  ) as [string, TemplateResource];
  const roleRef = props(fn)['Role'] as { 'Fn::GetAtt': [string, string] };
  const roleId = roleRef['Fn::GetAtt'][0];
  const policies = entriesOfType('AWS::IAM::Policy').filter(([, policy]) =>
    JSON.stringify(props(policy)['Roles']).includes(`"${roleId}"`),
  );
  const logGroupRef = (props(fn)['LoggingConfig'] as { LogGroup: { Ref: string } }).LogGroup.Ref;
  return {
    id,
    fn,
    props: props(fn),
    roleId,
    role: resources[roleId] as TemplateResource,
    policies,
    statements: policies.flatMap(
      ([, policy]) => (props(policy)['PolicyDocument'] as { Statement: Statement[] }).Statement,
    ),
    logGroupRef,
  };
}

/** The Function URL of a function: its logical id and properties. */
function functionUrlOf(name: FunctionName): [string, Json] {
  const target = lambdaOf(name).id;
  const found = entriesOfType('AWS::Lambda::Url').find(
    ([, url]) =>
      JSON.stringify(props(url)['TargetFunctionArn']) === JSON.stringify(getAtt(target, 'Arn')),
  );
  expect(found, `a Function URL for ${name}`).toBeDefined();
  const [id, url] = found as [string, TemplateResource];
  return [id, props(url)];
}

interface Statement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
}

const actionsOf = (statement: Statement): string[] => [statement.Action].flat();
const withAction = (statements: Statement[], action: string): Statement[] =>
  statements.filter((statement) => actionsOf(statement).includes(action));

const [tableId] = only('AWS::DynamoDB::Table');
const TABLE_ARN = getAtt(tableId, 'Arn');
const INDEX_ARN = { 'Fn::Join': ['', [TABLE_ARN, '/index/GSI1']] };
const SSM_ARN = `arn:aws:ssm:us-east-1:${TEST_ACCOUNT}:parameter/mergescape/*`;
const KMS_ARN = `arn:aws:kms:us-east-1:${TEST_ACCOUNT}:key/*`;

const INGEST_TABLE_ACTIONS = [
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:Query',
  'dynamodb:UpdateItem',
];
const API_TABLE_ACTIONS = [
  ...INGEST_TABLE_ACTIONS,
  'dynamodb:BatchWriteItem',
  'dynamodb:DeleteItem',
];

const FUNCTIONS = {
  ingest: {
    tableActions: INGEST_TABLE_ACTIONS,
    concurrency: 10,
    logGroup: '/aws/lambda/mergescape-prod-ingest',
    timeout: 10,
    // Table access, SSM and KMS.
    statements: 3,
  },
  api: {
    tableActions: API_TABLE_ACTIONS,
    concurrency: 5,
    logGroup: '/aws/lambda/mergescape-prod-api',
    // The weekly rollover walks every profile in this function.
    timeout: 60,
    // Table access, the rollover's GSI1 scan, SSM and KMS.
    statements: 4,
  },
} as const;

// --- Checks that were in validate.mjs ----------------------------------------------------------

describe('template shape (validate.mjs: transform, parameters, resource set)', () => {
  it('is plain CloudFormation: no SAM transform, and the only parameter is the bootstrap version', () => {
    expect(json.Transform).toBeUndefined();
    expect(Object.keys(json.Parameters ?? {})).toEqual(['BootstrapVersion']);
  });

  it('has exactly the expected resources and nothing else', () => {
    const counts: Record<string, number> = {};
    for (const resource of Object.values(resources)) {
      counts[resource.Type] = (counts[resource.Type] ?? 0) + 1;
    }
    expect(counts).toEqual({
      'AWS::DynamoDB::Table': 1,
      'AWS::Logs::LogGroup': 2,
      // One role, with one inline policy, per function; the Function URLs and the schedule add permissions.
      'AWS::IAM::Role': 2,
      'AWS::IAM::Policy': 2,
      'AWS::Lambda::Function': 2,
      'AWS::Lambda::Url': 2,
      'AWS::Lambda::Permission': 5,
      'AWS::Events::Rule': 1,
      'AWS::CloudFront::CachePolicy': 1,
      'AWS::CloudFront::Function': 1,
      'AWS::CloudFront::Distribution': 1,
      'AWS::Budgets::Budget': 2,
    });
  });

  it('globals: nodejs22.x, 256 MB, tracing off, exactly the five environment variables, no layers or VPC', () => {
    for (const name of ['ingest', 'api'] as const) {
      const { props: fn } = lambdaOf(name);
      expect(fn['Runtime']).toBe('nodejs22.x');
      expect(fn['MemorySize']).toBe(256);
      expect(fn['TracingConfig']).toBeUndefined();
      expect(fn['Layers']).toBeUndefined();
      expect(fn['VpcConfig']).toBeUndefined();
      expect(fn['Architectures']).toBeUndefined();
      expect(fn['Handler']).toBe('index.handler');
      expect(fn['Environment']).toEqual({
        Variables: {
          TABLE_NAME: { Ref: tableId },
          SSM_PREFIX: '/mergescape',
          PAGES_ORIGIN: 'https://octocat.github.io',
          CLIENT_BASE_PATH: '/',
          STAGE: 'prod',
        },
      });
    }
  });
});

describe('the table', () => {
  const [, table] = only('AWS::DynamoDB::Table');
  const tableProps = props(table);

  it('has PK/SK strings, provisioned 5/5 and TTL on ttl', () => {
    expect(tableProps['TableName']).toBe('mergescape');
    expect(tableProps['BillingMode']).toBeUndefined(); // PROVISIONED is CloudFormation's default
    expect(tableProps['ProvisionedThroughput']).toEqual({
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    });
    expect(tableProps['KeySchema']).toEqual([
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ]);
    const attributes = (tableProps['AttributeDefinitions'] as Json[]).map(
      (a) => `${String(a['AttributeName'])}:${String(a['AttributeType'])}`,
    );
    expect(sorted(attributes)).toEqual(['GSI1PK:S', 'GSI1SK:S', 'PK:S', 'SK:S']);
    expect(tableProps['TimeToLiveSpecification']).toEqual({ AttributeName: 'ttl', Enabled: true });
  });

  it('has GSI1 on GSI1PK/GSI1SK, an INCLUDE projection of the badge fields and its own 5/5', () => {
    expect(tableProps['GlobalSecondaryIndexes']).toEqual([
      {
        IndexName: 'GSI1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: {
          ProjectionType: 'INCLUDE',
          NonKeyAttributes: [
            'login',
            'level',
            'xp',
            'renown',
            'vocation',
            'pinned_feats',
            'old_coin',
            'badge_public',
          ],
        },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ]);
  });

  it('projects badge_public, so a player who turned the badge off is never shown by it', () => {
    const [index] = tableProps['GlobalSecondaryIndexes'] as Json[];
    expect((index?.['Projection'] as Json)['NonKeyAttributes']).toContain('badge_public');
  });

  it('is the projection the backend tests fake: the two lists name the same attributes', () => {
    // A fake that projected less would let the badge tests pass while the real index hid an attribute.
    const [index] = tableProps['GlobalSecondaryIndexes'] as Json[];
    expect(sorted(FAKE_GSI1_PROJECTION)).toEqual(
      sorted((index?.['Projection'] as Json)['NonKeyAttributes'] as string[]),
    );
  });

  it('is retained when the stack is deleted or replaced', () => {
    expect(table?.DeletionPolicy).toBe('Retain');
    expect(table?.UpdateReplacePolicy).toBe('Retain');
  });
});

for (const name of ['ingest', 'api'] as const) {
  const expected = FUNCTIONS[name];

  describe(`the ${name} function`, () => {
    const lambda = lambdaOf(name);
    const logGroup = resources[lambda.logGroupRef];

    it(`has reserved concurrency ${expected.concurrency} and logs to its own log group`, () => {
      expect(lambda.props['Handler']).toBe('index.handler');
      expect(lambda.props['ReservedConcurrentExecutions']).toBe(expected.concurrency);
      expect(logGroup?.Type).toBe('AWS::Logs::LogGroup');
      expect(props(logGroup)['LogGroupName']).toBe(expected.logGroup);
      expect(lambda.props['LoggingConfig']).toEqual({ LogGroup: { Ref: lambda.logGroupRef } });
    });

    it('takes its code from the CDK bootstrap assets bucket (the esbuild bundle itself is checked in bundling.test.ts)', () => {
      expect(props(lambda.fn)['Code']).toMatchObject({
        S3Bucket: `cdk-hnb659fds-assets-${TEST_ACCOUNT}-us-east-1`,
        S3Key: expect.stringMatching(/^[0-9a-f]{64}\.zip$/) as unknown,
      });
    });

    it(`has its own generated role with only the basic execution policy managed, and exactly ${expected.statements} inline statements`, () => {
      const role = props(lambda.role);
      expect(lambda.role.Type).toBe('AWS::IAM::Role');
      expect(role['RoleName']).toBeUndefined();
      expect(role['PermissionsBoundary']).toBeUndefined();
      expect(role['Policies']).toBeUndefined();
      expect(role['ManagedPolicyArns']).toEqual([
        {
          'Fn::Join': [
            '',
            [
              'arn:',
              { Ref: 'AWS::Partition' },
              ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            ],
          ],
        },
      ]);
      expect(role['AssumeRolePolicyDocument']).toEqual({
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
          },
        ],
      });
      expect(lambda.policies).toHaveLength(1);
      expect((props(lambda.policies[0]?.[1])['PolicyDocument'] as Json)['Version']).toBe(
        '2012-10-17',
      );
      expect(lambda.statements).toHaveLength(expected.statements);
    });

    it(`has a timeout of ${expected.timeout} s`, () => {
      expect(lambda.props['Timeout']).toBe(expected.timeout);
    });

    it(`allows only ${expected.tableActions.length} DynamoDB actions on the table and GSI1`, () => {
      const [statement, ...rest] = withAction(lambda.statements, 'dynamodb:GetItem');
      expect(rest).toHaveLength(0);
      expect(statement).toEqual({
        Sid: 'TableAccess',
        Effect: 'Allow',
        // CDK sorts the actions of a statement.
        Action: sorted(expected.tableActions),
        Resource: [TABLE_ARN, INDEX_ARN],
      });
    });

    it('reads SSM with GetParameter and GetParameters on the prefix only', () => {
      const [statement, ...rest] = withAction(lambda.statements, 'ssm:GetParameter');
      expect(rest).toHaveLength(0);
      expect(statement).toEqual({
        Sid: 'ReadSecrets',
        Effect: 'Allow',
        Action: ['ssm:GetParameter', 'ssm:GetParameters'],
        Resource: SSM_ARN,
      });
    });

    it('decrypts only with the default SSM key: alias/aws/ssm, through SSM', () => {
      const [statement, ...rest] = withAction(lambda.statements, 'kms:Decrypt');
      expect(rest).toHaveLength(0);
      expect(statement).toEqual({
        Sid: 'DecryptSecrets',
        Effect: 'Allow',
        Action: 'kms:Decrypt',
        Resource: KMS_ARN,
        Condition: {
          'ForAnyValue:StringEquals': { 'kms:ResourceAliases': 'alias/aws/ssm' },
          StringEquals: { 'kms:ViaService': 'ssm.us-east-1.amazonaws.com' },
        },
      });
    });

    it('has no wildcard action and no bare "*" resource', () => {
      expect(lambda.statements.length).toBeGreaterThan(0);
      for (const statement of lambda.statements) {
        expect(statement.Effect).toBe('Allow');
        for (const action of actionsOf(statement)) expect(action).not.toContain('*');
        for (const resource of [statement.Resource].flat()) expect(resource).not.toBe('*');
      }
    });
  });
}

describe('IAM across the stack', () => {
  it('Scan: only the api role has it, and only on the GSI1 index ARN (Requirement 12.2)', () => {
    const scans = (name: FunctionName) => withAction(lambdaOf(name).statements, 'dynamodb:Scan');
    expect(scans('api')).toEqual([
      { Sid: 'RolloverScan', Effect: 'Allow', Action: 'dynamodb:Scan', Resource: INDEX_ARN },
    ]);
    expect(scans('ingest')).toEqual([]);
    // Nothing else in the template can scan either.
    expect(JSON.stringify(json).match(/dynamodb:Scan/g)).toHaveLength(1);
  });

  it('no policy statement anywhere has a wildcard action or Resource "*"', () => {
    for (const [, policy] of entriesOfType('AWS::IAM::Policy')) {
      const statements = (props(policy)['PolicyDocument'] as { Statement: Statement[] }).Statement;
      for (const statement of statements) {
        for (const action of actionsOf(statement)) expect(action).not.toContain('*');
        for (const resource of [statement.Resource].flat()) expect(resource).not.toBe('*');
      }
    }
  });

  it('the only open principals are the two Function URLs (auth NONE) and they can only be invoked through them', () => {
    const open = entriesOfType('AWS::Lambda::Permission').filter(
      ([, permission]) => props(permission)['Principal'] === '*',
    );
    expect(open).toHaveLength(4);
    const kinds = open.map(([, permission]) => {
      const p = props(permission);
      return p['Action'] === 'lambda:InvokeFunctionUrl'
        ? `url:${String(p['FunctionUrlAuthType'])}`
        : `fn:${String(p['Action'])}:${String(p['InvokedViaFunctionUrl'])}`;
    });
    expect(sorted(kinds)).toEqual([
      'fn:lambda:InvokeFunction:true',
      'fn:lambda:InvokeFunction:true',
      'url:NONE',
      'url:NONE',
    ]);
  });
});

describe('Function URLs, schedule and logs', () => {
  it('ingest: Function URL with AuthType NONE and no CORS block', () => {
    expect(functionUrlOf('ingest')[1]).toEqual({
      AuthType: 'NONE',
      TargetFunctionArn: getAtt(lambdaOf('ingest').id, 'Arn'),
    });
  });

  it('api: Function URL AuthType NONE, CORS only for the Pages origin', () => {
    expect(functionUrlOf('api')[1]).toEqual({
      AuthType: 'NONE',
      TargetFunctionArn: getAtt(lambdaOf('api').id, 'Arn'),
      Cors: {
        AllowOrigins: ['https://octocat.github.io'],
        AllowMethods: ['GET', 'POST'],
        AllowHeaders: ['authorization', 'content-type'],
        MaxAge: 600,
      },
    });
  });

  it('api: the only event is the Monday 00:05 UTC rollover schedule', () => {
    const [ruleId, rule] = only('AWS::Events::Rule');
    const ruleProps = props(rule);
    expect(ruleProps['ScheduleExpression']).toBe('cron(5 0 ? * MON *)');
    expect(ruleProps['State']).toBe('ENABLED');
    const targets = ruleProps['Targets'] as { Arn: unknown; Input: string }[];
    expect(targets).toHaveLength(1);
    expect(targets[0]?.Arn).toEqual(getAtt(lambdaOf('api').id, 'Arn'));
    expect(JSON.parse(targets[0]?.Input ?? '')).toEqual({ action: 'rollover' });
    // The rule may invoke the api function, and only it.
    const grants = entriesOfType('AWS::Lambda::Permission').filter(
      ([, permission]) => props(permission)['Principal'] === 'events.amazonaws.com',
    );
    expect(grants).toHaveLength(1);
    expect(props(grants[0]?.[1])['SourceArn']).toEqual(getAtt(ruleId, 'Arn'));
    expect(props(grants[0]?.[1])['FunctionName']).toEqual(getAtt(lambdaOf('api').id, 'Arn'));
  });

  it('ingest: no events (the webhook arrives through the Function URL only)', () => {
    expect(JSON.stringify(props(only('AWS::Events::Rule')[1]))).not.toContain(
      lambdaOf('ingest').id,
    );
  });

  for (const name of ['ingest', 'api'] as const) {
    it(`${name} log group: retention 14 days, deleted with the stack`, () => {
      const group = resources[lambdaOf(name).logGroupRef];
      expect(props(group)['RetentionInDays']).toBe(14);
      expect(group?.DeletionPolicy).toBe('Delete');
    });
  }
});

describe('the badge distribution (Requirement 11.2)', () => {
  const [policyId, policy] = only('AWS::CloudFront::CachePolicy');
  const [functionId] = only('AWS::CloudFront::Function');
  const [, distribution] = only('AWS::CloudFront::Distribution');
  const config = props(distribution)['DistributionConfig'] as Json;

  it('has a cache policy with a 6 h default TTL and nothing in the cache key', () => {
    const cache = props(policy)['CachePolicyConfig'] as Json;
    expect(cache['DefaultTTL']).toBe(21600);
    expect(cache['MaxTTL']).toBe(86400);
    expect(cache['MinTTL']).toBe(0);
    expect(cache['ParametersInCacheKeyAndForwardedToOrigin']).toMatchObject({
      CookiesConfig: { CookieBehavior: 'none' },
      HeadersConfig: { HeaderBehavior: 'none' },
      QueryStringsConfig: { QueryStringBehavior: 'none' },
    });
  });

  it('has a single origin, the api Function URL domain', () => {
    const origins = config['Origins'] as Json[];
    expect(origins).toHaveLength(1);
    expect(origins[0]?.['DomainName']).toEqual({
      'Fn::Select': [
        2,
        {
          'Fn::Split': ['/', getAtt(functionUrlOf('api')[0], 'FunctionUrl')],
        },
      ],
    });
    expect(origins[0]?.['CustomOriginConfig']).toMatchObject({
      OriginProtocolPolicy: 'https-only',
    });
  });

  it('caches /badge/* (GET and HEAD) and answers 404 at the edge for everything else', () => {
    const behaviors = config['CacheBehaviors'] as Json[];
    expect(behaviors).toHaveLength(1);
    expect(behaviors[0]).toMatchObject({
      PathPattern: '/badge/*',
      CachePolicyId: { Ref: policyId },
      AllowedMethods: ['GET', 'HEAD'],
      ViewerProtocolPolicy: 'redirect-to-https',
    });
    expect(config['DefaultCacheBehavior']).toMatchObject({
      AllowedMethods: ['GET', 'HEAD'],
      // The managed CachingDisabled policy.
      CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
      FunctionAssociations: [
        { EventType: 'viewer-request', FunctionARN: getAtt(functionId, 'FunctionARN') },
      ],
    });
  });

  it('runs a CloudFront Function that returns 404 and nothing else', () => {
    const code = String(props(only('AWS::CloudFront::Function')[1])['FunctionCode']);
    expect(code).toContain('statusCode: 404');
    expect(code).not.toContain('request');
    expect(props(only('AWS::CloudFront::Function')[1])['AutoPublish']).toBe(true);
  });
});

describe('the budgets', () => {
  const budgetOf = (amount: number) =>
    entriesOfType('AWS::Budgets::Budget')
      .map(([, budget]) => props(budget))
      .find(
        (budget) =>
          (budget['Budget'] as Json)['BudgetName'] === `mergescape-prod-monthly-${amount}-usd`,
      );

  for (const amount of [1, 10]) {
    it(`has a monthly cost budget of ${amount} USD, e-mailing the alert address at 100 % of actual spend`, () => {
      const budget = budgetOf(amount);
      expect(budget?.['Budget']).toMatchObject({
        BudgetType: 'COST',
        TimeUnit: 'MONTHLY',
        BudgetLimit: { Amount: amount, Unit: 'USD' },
      });
      const notifications = budget?.['NotificationsWithSubscribers'] as Json[];
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toEqual({
        Notification: {
          NotificationType: 'ACTUAL',
          ComparisonOperator: 'GREATER_THAN',
          Threshold: 100,
          ThresholdType: 'PERCENTAGE',
        },
        Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'octocat@example.org' }],
      });
    });
  }
});

describe('outputs', () => {
  it('are TableName, IngestUrl, ApiUrl and BadgeDomain', () => {
    expect(sorted(Object.keys(json.Outputs))).toEqual([
      'ApiUrl',
      'BadgeDomain',
      'IngestUrl',
      'TableName',
    ]);
    expect(json.Outputs['TableName']?.Value).toEqual({ Ref: tableId });
    expect(json.Outputs['IngestUrl']?.Value).toEqual(
      getAtt(functionUrlOf('ingest')[0], 'FunctionUrl'),
    );
    expect(json.Outputs['ApiUrl']?.Value).toEqual(getAtt(functionUrlOf('api')[0], 'FunctionUrl'));
    expect(json.Outputs['BadgeDomain']?.Value).toEqual(
      getAtt(only('AWS::CloudFront::Distribution')[0], 'DomainName'),
    );
    expect(json.Outputs['IngestUrl']?.Description).toContain('webhook URL');
  });
});

// --- Snapshot ----------------------------------------------------------------------------------

describe('snapshot', () => {
  it('matches the committed synthesized template', async () => {
    // Regenerate with `pnpm --filter @mergescape/infra exec vitest run -u` after an intended change. The file
    // is written the way `prettier --write` would, so that `pnpm lint` accepts it.
    const text = await format(JSON.stringify(json), {
      ...(await resolveConfig(SNAPSHOT)),
      filepath: SNAPSHOT,
    });
    await expect(text).toMatchFileSnapshot(SNAPSHOT);
  });
});

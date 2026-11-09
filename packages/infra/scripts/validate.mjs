// Validates packages/infra/template.yaml.
//
// 1. Always: parses the template (CloudFormation short-form tags included) and asserts the
//    resource set, the table definition, function settings and the exact IAM statements the
//    requirements call for (Requirement 12). Exits non-zero on any mismatch.
// 2. When the SAM CLI is installed: also runs `sam validate --lint`. Otherwise prints
//    "sam not installed" and relies on step 1 alone.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert/strict';
import { parse } from 'yaml';

// An optional first argument validates another file (used to test this script).
const templatePath = process.argv[2]
  ? resolve(process.argv[2])
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'template.yaml');

// --- Parsing -------------------------------------------------------------------------------

const scalarTags = {
  Ref: (v) => ({ Ref: v }),
  Condition: (v) => ({ Condition: v }),
  Base64: (v) => ({ 'Fn::Base64': v }),
  ImportValue: (v) => ({ 'Fn::ImportValue': v }),
  GetAZs: (v) => ({ 'Fn::GetAZs': v }),
  Sub: (v) => ({ 'Fn::Sub': v }),
  GetAtt: (v) => ({ 'Fn::GetAtt': v.split('.') }),
};
const sequenceTags = {
  And: 'Fn::And',
  Cidr: 'Fn::Cidr',
  Equals: 'Fn::Equals',
  FindInMap: 'Fn::FindInMap',
  GetAtt: 'Fn::GetAtt',
  If: 'Fn::If',
  Join: 'Fn::Join',
  Not: 'Fn::Not',
  Or: 'Fn::Or',
  Select: 'Fn::Select',
  Split: 'Fn::Split',
  Sub: 'Fn::Sub',
};

const customTags = [
  ...Object.entries(scalarTags).map(([name, build]) => ({
    tag: `!${name}`,
    resolve: (value) => build(String(value)),
  })),
  ...Object.entries(sequenceTags).map(([name, key]) => ({
    tag: `!${name}`,
    collection: 'seq',
    resolve: (seq) => ({ [key]: seq.toJSON() }),
  })),
];

let template;
try {
  template = parse(readFileSync(templatePath, 'utf8'), { customTags });
} catch (error) {
  console.error(`${templatePath}: cannot parse: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

// --- Assertion helpers ---------------------------------------------------------------------

const failures = [];
let checks = 0;

function check(name, fn) {
  checks += 1;
  try {
    fn();
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    failures.push(`${name}: ${detail}`);
  }
}

const show = (value) => {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
};

function equal(actual, expected) {
  try {
    deepStrictEqual(actual, expected);
  } catch {
    throw new Error(`expected ${show(expected)} but found ${show(actual)}`);
  }
}
const sorted = (list) => [...list].sort();
const ref = (name) => ({ Ref: name });
const getAtt = (name, attribute) => ({ 'Fn::GetAtt': [name, attribute] });
const sub = (text) => ({ 'Fn::Sub': text });

// --- Expectations --------------------------------------------------------------------------

const RESOURCE_TYPES = {
  Table: 'AWS::DynamoDB::Table',
  IngestLogGroup: 'AWS::Logs::LogGroup',
  ApiLogGroup: 'AWS::Logs::LogGroup',
  IngestFunction: 'AWS::Serverless::Function',
  ApiFunction: 'AWS::Serverless::Function',
  BadgeCachePolicy: 'AWS::CloudFront::CachePolicy',
  BadgeNotFoundFunction: 'AWS::CloudFront::Function',
  BadgeDistribution: 'AWS::CloudFront::Distribution',
  Budget1Usd: 'AWS::Budgets::Budget',
  Budget10Usd: 'AWS::Budgets::Budget',
};

const TABLE_ARN = getAtt('Table', 'Arn');
const INDEX_ARN = sub('${Table.Arn}/index/GSI1');
const SSM_ARN = sub(
  'arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${SsmPrefix}/*',
);
const KMS_ARN = sub('arn:${AWS::Partition}:kms:${AWS::Region}:${AWS::AccountId}:key/*');

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
  IngestFunction: {
    tableActions: INGEST_TABLE_ACTIONS,
    concurrency: 10,
    entryPoint: 'backend/src/handlers/ingest.ts',
    handler: 'ingest.handler',
    logGroup: 'IngestLogGroup',
    timeout: undefined,
    statements: 3,
  },
  ApiFunction: {
    tableActions: API_TABLE_ACTIONS,
    concurrency: 5,
    entryPoint: 'backend/src/handlers/api.ts',
    handler: 'api.handler',
    logGroup: 'ApiLogGroup',
    // The weekly rollover walks every profile in this function.
    timeout: 60,
    // Table access, the rollover's GSI1 scan, SSM and KMS.
    statements: 4,
  },
};

const resources = template.Resources ?? {};

// --- Checks --------------------------------------------------------------------------------

check('template: transform is AWS::Serverless-2016-10-31', () => {
  equal(template.Transform, 'AWS::Serverless-2016-10-31');
});

check('parameters: PagesOrigin, ClientBasePath, SsmPrefix, Stage, AlertEmail', () => {
  equal(sorted(Object.keys(template.Parameters ?? {})), [
    'AlertEmail',
    'ClientBasePath',
    'PagesOrigin',
    'SsmPrefix',
    'Stage',
  ]);
});

check('resources: exact logical id and type set (plus nothing unexpected)', () => {
  const actual = Object.fromEntries(Object.entries(resources).map(([id, r]) => [id, r.Type]));
  equal(actual, RESOURCE_TYPES);
});

check('globals: nodejs22.x, 256 MB, 10 s, tracing off, environment variables', () => {
  const globals = template.Globals?.Function ?? {};
  equal(globals.Runtime, 'nodejs22.x');
  equal(globals.MemorySize, 256);
  equal(globals.Timeout, 10);
  equal(globals.Tracing, 'Disabled');
  equal(globals.Environment?.Variables, {
    TABLE_NAME: ref('Table'),
    SSM_PREFIX: ref('SsmPrefix'),
    PAGES_ORIGIN: ref('PagesOrigin'),
    CLIENT_BASE_PATH: ref('ClientBasePath'),
    STAGE: ref('Stage'),
  });
});

check('table: PK/SK strings, provisioned 5/5, TTL on ttl', () => {
  const props = resources.Table?.Properties ?? {};
  equal(props.BillingMode, 'PROVISIONED');
  equal(props.ProvisionedThroughput, { ReadCapacityUnits: 5, WriteCapacityUnits: 5 });
  equal(props.KeySchema, [
    { AttributeName: 'PK', KeyType: 'HASH' },
    { AttributeName: 'SK', KeyType: 'RANGE' },
  ]);
  equal(sorted(props.AttributeDefinitions.map((a) => `${a.AttributeName}:${a.AttributeType}`)), [
    'GSI1PK:S',
    'GSI1SK:S',
    'PK:S',
    'SK:S',
  ]);
  equal(props.TimeToLiveSpecification, { AttributeName: 'ttl', Enabled: true });
});

check('table: GSI1 on GSI1PK/GSI1SK, INCLUDE projection of the badge fields, own 5/5', () => {
  equal(resources.Table?.Properties?.GlobalSecondaryIndexes, [
    {
      IndexName: 'GSI1',
      KeySchema: [
        { AttributeName: 'GSI1PK', KeyType: 'HASH' },
        { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
      ],
      Projection: {
        ProjectionType: 'INCLUDE',
        NonKeyAttributes: ['login', 'level', 'xp', 'renown', 'vocation'],
      },
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
  ]);
});

check('table: retained when the stack is deleted or replaced', () => {
  equal(resources.Table?.DeletionPolicy, 'Retain');
  equal(resources.Table?.UpdateReplacePolicy, 'Retain');
});

for (const [id, expected] of Object.entries(FUNCTIONS)) {
  const fn = resources[id] ?? {};
  const props = fn.Properties ?? {};

  check(`${id}: handler, reserved concurrency ${expected.concurrency}, log group`, () => {
    equal(props.Handler, expected.handler);
    equal(props.ReservedConcurrentExecutions, expected.concurrency);
    equal(props.LoggingConfig, { LogGroup: ref(expected.logGroup) });
  });

  check(`${id}: esbuild bundling, minified, no sourcemap, node22`, () => {
    equal(fn.Metadata?.BuildMethod, 'esbuild');
    equal(fn.Metadata?.BuildProperties, {
      EntryPoints: [expected.entryPoint],
      Minify: true,
      Sourcemap: false,
      Target: 'node22',
    });
  });

  check(
    `${id}: no role override, no managed policies, exactly ${expected.statements} inline statements`,
    () => {
      equal(props.Role, undefined);
      equal(props.PermissionsBoundary, undefined);
      equal(props.Policies.length, 1);
      equal(typeof props.Policies[0], 'object');
      equal(props.Policies[0].Version, '2012-10-17');
      equal(props.Policies[0].Statement.length, expected.statements);
    },
  );

  check(`${id}: timeout ${expected.timeout ?? 'inherited from Globals (10 s)'}`, () => {
    equal(props.Timeout, expected.timeout);
  });

  const statements = props.Policies?.[0]?.Statement ?? [];
  const byAction = (action) => statements.filter((s) => [s.Action].flat().includes(action));

  check(
    `${id}: DynamoDB statement allows only ${expected.tableActions.length} actions on the table and GSI1`,
    () => {
      const [statement, ...rest] = byAction('dynamodb:GetItem');
      equal(rest.length, 0);
      equal(statement.Effect, 'Allow');
      equal(sorted(statement.Action), sorted(expected.tableActions));
      equal(statement.Resource, [TABLE_ARN, INDEX_ARN]);
      equal(statement.Condition, undefined);
    },
  );

  check(`${id}: SSM statement is GetParameter and GetParameters on the prefix only`, () => {
    const [statement, ...rest] = byAction('ssm:GetParameter');
    equal(rest.length, 0);
    equal(statement.Effect, 'Allow');
    equal(sorted(statement.Action), ['ssm:GetParameter', 'ssm:GetParameters']);
    equal(statement.Resource, SSM_ARN);
  });

  check(`${id}: KMS statement is Decrypt on the default SSM key (alias/aws/ssm via SSM)`, () => {
    const [statement, ...rest] = byAction('kms:Decrypt');
    equal(rest.length, 0);
    equal(statement.Effect, 'Allow');
    equal(statement.Action, 'kms:Decrypt');
    equal(statement.Resource, KMS_ARN);
    equal(statement.Condition, {
      'ForAnyValue:StringEquals': { 'kms:ResourceAliases': 'alias/aws/ssm' },
      StringEquals: { 'kms:ViaService': sub('ssm.${AWS::Region}.amazonaws.com') },
    });
  });

  check(`${id}: no wildcard actions, no bare "*" resources`, () => {
    for (const statement of statements) {
      for (const action of [statement.Action].flat()) {
        if (typeof action !== 'string' || action.includes('*')) throw new Error(`action ${action}`);
      }
      for (const resource of [statement.Resource].flat()) {
        if (resource === '*') throw new Error('Resource "*"');
      }
    }
  });
}

check('Scan: only the api role has it, and only on the GSI1 index ARN (Requirement 12.2)', () => {
  for (const [id, fn] of Object.entries(resources)) {
    if (fn.Type !== 'AWS::Serverless::Function') continue;
    const scans = (fn.Properties?.Policies?.[0]?.Statement ?? []).filter((s) =>
      [s.Action].flat().includes('dynamodb:Scan'),
    );
    if (id === 'ApiFunction') {
      equal(scans.length, 1);
      equal(scans[0].Effect, 'Allow');
      equal(scans[0].Action, 'dynamodb:Scan');
      equal(scans[0].Resource, INDEX_ARN);
      equal(scans[0].Condition, undefined);
    } else {
      equal(scans.length, 0);
    }
  }
});

check('IngestFunction: Function URL with AuthType NONE and no CORS block', () => {
  equal(resources.IngestFunction?.Properties?.FunctionUrlConfig, { AuthType: 'NONE' });
});

check('ApiFunction: Function URL AuthType NONE, CORS only for PagesOrigin', () => {
  equal(resources.ApiFunction?.Properties?.FunctionUrlConfig, {
    AuthType: 'NONE',
    Cors: {
      AllowOrigins: [ref('PagesOrigin')],
      AllowMethods: ['GET', 'POST'],
      AllowHeaders: ['authorization', 'content-type'],
      MaxAge: 600,
    },
  });
});

check('ApiFunction: only event is the Monday 00:05 UTC rollover schedule', () => {
  const events = resources.ApiFunction?.Properties?.Events ?? {};
  equal(Object.keys(events), ['Rollover']);
  equal(events.Rollover.Type, 'Schedule');
  equal(events.Rollover.Properties.Schedule, 'cron(5 0 ? * MON *)');
  equal(events.Rollover.Properties.Enabled, true);
  equal(JSON.parse(events.Rollover.Properties.Input), { action: 'rollover' });
});

check('IngestFunction: no events (the webhook arrives through the Function URL only)', () => {
  equal(resources.IngestFunction?.Properties?.Events, undefined);
});

for (const id of ['IngestLogGroup', 'ApiLogGroup']) {
  check(`${id}: retention 14 days`, () => {
    equal(resources[id]?.Properties?.RetentionInDays, 14);
  });
}

check('BadgeCachePolicy: default TTL 21600 (6 h), nothing in the cache key', () => {
  const config = resources.BadgeCachePolicy?.Properties?.CachePolicyConfig ?? {};
  equal(config.DefaultTTL, 21600);
  const keys = config.ParametersInCacheKeyAndForwardedToOrigin;
  equal(keys.CookiesConfig, { CookieBehavior: 'none' });
  equal(keys.HeadersConfig, { HeaderBehavior: 'none' });
  equal(keys.QueryStringsConfig, { QueryStringBehavior: 'none' });
});

check('BadgeDistribution: single origin is the api Function URL domain', () => {
  const config = resources.BadgeDistribution?.Properties?.DistributionConfig ?? {};
  equal(config.Origins.length, 1);
  equal(config.Origins[0].DomainName, {
    'Fn::Select': [2, { 'Fn::Split': ['/', getAtt('ApiFunctionUrl', 'FunctionUrl')] }],
  });
  equal(config.Origins[0].CustomOriginConfig.OriginProtocolPolicy, 'https-only');
});

check(
  'BadgeDistribution: /badge/* is cached (GET/HEAD); everything else is a 404 at the edge',
  () => {
    const config = resources.BadgeDistribution?.Properties?.DistributionConfig ?? {};
    equal(config.CacheBehaviors.length, 1);
    const [badge] = config.CacheBehaviors;
    equal(badge.PathPattern, '/badge/*');
    equal(badge.CachePolicyId, ref('BadgeCachePolicy'));
    equal(badge.AllowedMethods, ['GET', 'HEAD']);
    equal(badge.ViewerProtocolPolicy, 'redirect-to-https');
    const fallback = config.DefaultCacheBehavior;
    equal(fallback.AllowedMethods, ['GET', 'HEAD']);
    equal(fallback.FunctionAssociations, [
      { EventType: 'viewer-request', FunctionARN: getAtt('BadgeNotFoundFunction', 'FunctionARN') },
    ]);
  },
);

for (const [id, amount] of [
  ['Budget1Usd', 1],
  ['Budget10Usd', 10],
]) {
  check(`${id}: monthly cost budget of ${amount} USD, e-mail subscriber from AlertEmail`, () => {
    const props = resources[id]?.Properties ?? {};
    equal(props.Budget.BudgetType, 'COST');
    equal(props.Budget.TimeUnit, 'MONTHLY');
    equal(props.Budget.BudgetLimit, { Amount: amount, Unit: 'USD' });
    equal(props.NotificationsWithSubscribers.length, 1);
    equal(props.NotificationsWithSubscribers[0].Subscribers, [
      { SubscriptionType: 'EMAIL', Address: ref('AlertEmail') },
    ]);
  });
}

check('outputs: TableName, IngestUrl, ApiUrl, BadgeDomain', () => {
  const outputs = template.Outputs ?? {};
  equal(sorted(Object.keys(outputs)), ['ApiUrl', 'BadgeDomain', 'IngestUrl', 'TableName']);
  equal(outputs.TableName.Value, ref('Table'));
  equal(outputs.IngestUrl.Value, getAtt('IngestFunctionUrl', 'FunctionUrl'));
  equal(outputs.ApiUrl.Value, getAtt('ApiFunctionUrl', 'FunctionUrl'));
  equal(outputs.BadgeDomain.Value, getAtt('BadgeDistribution', 'DomainName'));
});

// --- Report --------------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`template.yaml: ${failures.length} of ${checks} checks failed`);
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`template.yaml: ${checks} structural checks passed`);
}

// --- SAM CLI (optional) --------------------------------------------------------------------

const shell = process.platform === 'win32';
const probe = spawnSync('sam', ['--version'], { stdio: 'ignore', shell });

if (probe.error || probe.status !== 0) {
  console.log('sam not installed');
} else {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
  const result = spawnSync(
    'sam',
    ['validate', '--lint', '--template-file', basename(templatePath), '--region', region],
    {
      cwd: dirname(templatePath),
      env: { ...process.env, SAM_CLI_TELEMETRY: process.env.SAM_CLI_TELEMETRY ?? '0' },
      stdio: 'inherit',
      shell,
    },
  );
  if ((result.status ?? 1) !== 0) process.exitCode = 1;
}

/**
 * The whole AWS side of Mergescape as one CDK stack (Requirement 12): the ingest and api Lambdas behind
 * Function URLs, one provisioned DynamoDB table, a CloudFront distribution for the badge path, the weekly
 * rollover schedule and two cost budgets. It is the CDK form of the SAM template it replaced (task 25), with
 * the same resources and the same IAM.
 */
import { fileURLToPath } from 'node:url';
import { ArnFormat, CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { baseNameFor } from './settings';
import type { Settings } from './settings';

/** The handlers' sources, bundled by esbuild into one file each. */
const handlerEntry = (name: 'ingest' | 'api'): string =>
  fileURLToPath(new URL(`../../backend/src/handlers/${name}.ts`, import.meta.url));

/** The workspace's lock file marks the project root: esbuild runs there and follows the pnpm links to `shared`. */
const LOCK_FILE = fileURLToPath(new URL('../../../pnpm-lock.yaml', import.meta.url));

/**
 * Attributes of a profile that GSI1 carries: the badge reads them from the index (login, level, vocation and
 * Renown, plus the pinned Feats and the Old Coin of task 22, and `badge_public`, the player's choice to keep
 * the badge from showing them, of task 24) and so does the rollover's scan.
 */
export const GSI1_PROJECTED_ATTRIBUTES = [
  'login',
  'level',
  'xp',
  'renown',
  'vocation',
  'pinned_feats',
  'old_coin',
  'badge_public',
] as const;

export const INGEST_TABLE_ACTIONS = [
  'dynamodb:PutItem',
  'dynamodb:GetItem',
  'dynamodb:UpdateItem',
  'dynamodb:Query',
] as const;

export const API_TABLE_ACTIONS = [
  ...INGEST_TABLE_ACTIONS,
  'dynamodb:DeleteItem',
  'dynamodb:BatchWriteItem',
] as const;

export interface MergescapeStackProps extends StackProps {
  readonly settings: Settings;
}

export class MergescapeStack extends Stack {
  readonly table: dynamodb.Table;
  readonly ingestFunction: nodejs.NodejsFunction;
  readonly apiFunction: nodejs.NodejsFunction;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MergescapeStackProps) {
    super(scope, id, props);
    const { pagesOrigin, clientBasePath, ssmPrefix, stage, alertEmail } = props.settings;
    const name = baseNameFor(stage);

    // ---------------------------------------------------------------------------------------------
    // Data
    // ---------------------------------------------------------------------------------------------
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: name,
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 5,
      writeCapacity: 5,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      // Player data outlives the stack. Delete the table by hand when decommissioning.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // The badge and the weekly rollover's scan read only these; the rest of the profile is fetched from the
    // table. Add an attribute here, in the stack test and in the snapshot together.
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: [...GSI1_PROJECTED_ATTRIBUTES],
      readCapacity: 5,
      writeCapacity: 5,
    });
    const indexArn = `${this.table.tableArn}/index/GSI1`;

    // ---------------------------------------------------------------------------------------------
    // Functions. Each has its log group (14-day retention) and exactly the permissions below.
    // ---------------------------------------------------------------------------------------------
    const environment = {
      TABLE_NAME: this.table.tableName,
      SSM_PREFIX: ssmPrefix,
      PAGES_ORIGIN: pagesOrigin,
      CLIENT_BASE_PATH: clientBasePath,
      STAGE: stage,
    };

    const functionBase = (
      logicalId: 'Ingest' | 'Api',
      handler: 'ingest' | 'api',
    ): nodejs.NodejsFunctionProps => ({
      entry: handlerEntry(handler),
      depsLockFilePath: LOCK_FILE,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      tracing: lambda.Tracing.DISABLED,
      functionName: `mergescape-${stage}-${handler}`,
      environment,
      logGroup: new logs.LogGroup(this, `${logicalId}LogGroup`, {
        logGroupName: `/aws/lambda/mergescape-${stage}-${handler}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        // The SAM log groups were deleted with the stack; CDK's default would keep them.
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node22',
        // Everything is bundled, the AWS SDK too, so the Lambda runs the SDK version pinned in the catalog.
        bundleAwsSDK: true,
      },
    });

    this.ingestFunction = new nodejs.NodejsFunction(this, 'IngestFunction', {
      ...functionBase('Ingest', 'ingest'),
      description: 'Verifies GitHub webhook signatures, scores events and writes the results.',
      reservedConcurrentExecutions: 10,
    });
    this.apiFunction = new nodejs.NodejsFunction(this, 'ApiFunction', {
      ...functionBase('Api', 'api'),
      description: 'OAuth callback, JWT-protected game API, badge SVG and the weekly rollover.',
      // The Monday rollover walks every profile in this function, so it gets a longer limit than the
      // 10 s of the request paths.
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: 5,
    });

    const secretsArn = this.formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: `${ssmPrefix.slice(1)}/*`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
    const anyKeyArn = this.formatArn({
      service: 'kms',
      resource: 'key',
      resourceName: '*',
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });

    const readSecrets = (): iam.PolicyStatement[] => [
      new iam.PolicyStatement({
        sid: 'ReadSecrets',
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [secretsArn],
      }),
      // SecureString parameters use the AWS managed key alias/aws/ssm. Its key id is not known at synth time,
      // so the key ARN is a wildcard that the conditions narrow to that one key, used through SSM only.
      new iam.PolicyStatement({
        sid: 'DecryptSecrets',
        actions: ['kms:Decrypt'],
        resources: [anyKeyArn],
        conditions: {
          'ForAnyValue:StringEquals': { 'kms:ResourceAliases': 'alias/aws/ssm' },
          StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` },
        },
      }),
    ];

    const tableAccess = (actions: readonly string[]): iam.PolicyStatement =>
      new iam.PolicyStatement({
        sid: 'TableAccess',
        actions: [...actions],
        resources: [this.table.tableArn, indexArn],
      });

    for (const statement of [tableAccess(INGEST_TABLE_ACTIONS), ...readSecrets()]) {
      this.ingestFunction.addToRolePolicy(statement);
    }
    for (const statement of [
      tableAccess(API_TABLE_ACTIONS),
      // The weekly rollover pages through every profile with a Scan of the sparse GSI1, which holds only
      // profiles. The table itself can never be scanned.
      new iam.PolicyStatement({
        sid: 'RolloverScan',
        actions: ['dynamodb:Scan'],
        resources: [indexArn],
      }),
      ...readSecrets(),
    ]) {
      this.apiFunction.addToRolePolicy(statement);
    }

    // ---------------------------------------------------------------------------------------------
    // Function URLs. Both are auth NONE: ingest is protected by the HMAC check inside the handler, api
    // by its JWT and the Origin check.
    // ---------------------------------------------------------------------------------------------
    const ingestUrl = this.ingestFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    const apiUrl = this.apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [pagesOrigin],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
        allowedHeaders: ['authorization', 'content-type'],
        maxAge: Duration.seconds(600),
      },
    });

    // ---------------------------------------------------------------------------------------------
    // Weekly run rollover: Monday 00:05 UTC
    // ---------------------------------------------------------------------------------------------
    new events.Rule(this, 'RolloverRule', {
      description: 'Monday 00:05 UTC weekly run rollover',
      schedule: events.Schedule.expression('cron(5 0 ? * MON *)'),
      enabled: true,
      targets: [
        new targets.LambdaFunction(this.apiFunction, {
          event: events.RuleTargetInput.fromObject({ action: 'rollover' }),
        }),
      ],
    });

    // ---------------------------------------------------------------------------------------------
    // CloudFront in front of the api Function URL, for /badge/* only (Requirement 11.2)
    // ---------------------------------------------------------------------------------------------
    const badgeCachePolicy = new cloudfront.CachePolicy(this, 'BadgeCachePolicy', {
      cachePolicyName: `${this.stackName}-${this.region}-badge`,
      comment: 'Badges are cached for 6 hours unless the origin says otherwise.',
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(21600),
      maxTtl: Duration.seconds(86400),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
    });

    // Anything outside /badge/* gets a 404 at the edge and never reaches the api.
    const notFound = new cloudfront.Function(this, 'BadgeNotFoundFunction', {
      functionName: `${this.stackName}-${this.region}-not-found`,
      comment: 'Return 404 for every path that is not a badge.',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      autoPublish: true,
      code: cloudfront.FunctionCode.fromInline(
        "function handler() {\n  return { statusCode: 404, statusDescription: 'Not Found' };\n}\n",
      ),
    });

    const apiOrigin = new origins.FunctionUrlOrigin(apiUrl);
    this.distribution = new cloudfront.Distribution(this, 'BadgeDistribution', {
      comment: `Mergescape ${stage} badges`,
      enabled: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: apiOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        compress: false,
        functionAssociations: [
          { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: notFound },
        ],
      },
      additionalBehaviors: {
        '/badge/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: badgeCachePolicy,
          compress: true,
        },
      },
    });

    // ---------------------------------------------------------------------------------------------
    // Cost guards. Budgets cover the whole AWS account, not just this stack.
    // ---------------------------------------------------------------------------------------------
    for (const [logicalId, amount] of [
      ['Budget1Usd', 1],
      ['Budget10Usd', 10],
    ] as const) {
      new budgets.CfnBudget(this, logicalId, {
        budget: {
          budgetName: `mergescape-${stage}-monthly-${amount}-usd`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
          },
        ],
      });
    }

    // ---------------------------------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------------------------------
    new CfnOutput(this, 'TableName', {
      description: 'DynamoDB table name.',
      value: this.table.tableName,
    });
    new CfnOutput(this, 'IngestUrl', {
      description: 'Function URL of the ingest Lambda. Set it as the GitHub App webhook URL.',
      value: ingestUrl.url,
    });
    new CfnOutput(this, 'ApiUrl', {
      description: 'Function URL of the api Lambda. Used as VITE_API_ORIGIN for the client build.',
      value: apiUrl.url,
    });
    new CfnOutput(this, 'BadgeDomain', {
      description: 'CloudFront domain that serves /badge/{login}.svg.',
      value: this.distribution.distributionDomainName,
    });
  }
}

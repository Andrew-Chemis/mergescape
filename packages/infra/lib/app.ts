/**
 * Builds the app's single stack from CDK context. `bin/mergescape.ts` runs it for the CLI and the tests run it
 * on an app seeded with `cdk.json`'s context, so a test synthesizes exactly what `cdk synth` does.
 *
 * Context (defaults in cdk.json, override with `-c key=value`): accountId, region, pagesOrigin, alertEmail,
 * stage, ssmPrefix, clientBasePath. Nothing looks anything up in AWS, so synthesis needs no credentials.
 */
import type { App } from 'aws-cdk-lib';
import { MergescapeStack } from './mergescape-stack';
import { baseNameFor, readSettings } from './settings';

export function createMergescapeStack(app: App): MergescapeStack {
  const settings = readSettings((key) => app.node.tryGetContext(key));
  return new MergescapeStack(app, 'Mergescape', {
    stackName: baseNameFor(settings.stage),
    description:
      'Mergescape: webhook ingest and API Lambdas behind Function URLs, one provisioned DynamoDB table, ' +
      'a CloudFront distribution for badges, a weekly rollover schedule and cost budgets.',
    // With no account the stack is environment-agnostic: fine to synthesize, but `cdk deploy` would then use
    // the credentials' own account. deploy.yml always passes the account.
    env: { account: settings.accountId, region: settings.region },
    settings,
  });
}

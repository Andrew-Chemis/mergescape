/**
 * Test helpers: build the app the way `cdk synth` does (context from cdk.json, so the feature flags match),
 * without AWS credentials and, by default, without running esbuild.
 */
import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { createMergescapeStack } from '../lib/app';

const cdkJson = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8')) as {
  app: string;
  output: string;
  context: Record<string, unknown>;
};

/** What cdk.json ships: the defaults every test starts from. */
export const CDK_JSON = cdkJson;

/** A made-up account: the landing zone only vends the real one later. */
export const TEST_ACCOUNT = '123456789012';

/** The values a deploy passes with `-c`. */
export const DEPLOY_CONTEXT = {
  accountId: TEST_ACCOUNT,
  pagesOrigin: 'https://octocat.github.io',
  alertEmail: 'octocat@example.org',
};

export interface SynthOptions {
  /** Run esbuild for real. Off by default: the asset hash is then a stable placeholder. */
  bundle?: boolean;
  outdir?: string;
}

export function synth(
  context: Record<string, unknown> = DEPLOY_CONTEXT,
  options: SynthOptions = {},
) {
  const app = new App({
    analyticsReporting: false,
    outdir: options.outdir,
    context: {
      ...cdkJson.context,
      // An empty list means "bundle no stack".
      'aws:cdk:bundling-stacks': options.bundle ? ['**'] : [],
      ...context,
    },
  });
  const stack = createMergescapeStack(app);
  return { app, stack, template: Template.fromStack(stack) };
}

export type Json = Record<string, unknown>;

export interface TemplateResource {
  Type: string;
  Properties?: Json;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  DependsOn?: string | string[];
}

export interface TemplateJson {
  Description?: string;
  Transform?: unknown;
  Parameters?: Record<string, unknown>;
  Resources: Record<string, TemplateResource>;
  Outputs: Record<string, { Description: string; Value: unknown }>;
}

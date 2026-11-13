#!/usr/bin/env node
/**
 * Entry point of the CDK app (`cdk.json` runs it): one stack, `Mergescape`, in the AWS account the landing
 * zone vended for this app and in us-east-1 unless `-c region=` says otherwise. See `lib/app.ts` for the context.
 */
import { App } from 'aws-cdk-lib';
import { createMergescapeStack } from '../lib/app';

// No AWS::CDK::Metadata resource: the template holds exactly the resources of the stack.
createMergescapeStack(new App({ analyticsReporting: false }));

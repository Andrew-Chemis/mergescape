/**
 * Production wiring shared by the Lambda entry points: real AWS clients built once per container, lazily,
 * so importing a handler (in a test, say) needs no environment and makes no network call.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadConfig } from './config';
import type { Config } from './config';
import { Db } from './db';
import { createLogger } from './log';
import type { Logger } from './log';
import { createSecrets } from './secrets';
import type { Secrets } from './secrets';

export interface Runtime {
  config: Config;
  db: Db;
  secrets: Secrets;
  log: Logger;
}

let cached: Runtime | undefined;

export function getRuntime(): Runtime {
  if (!cached) {
    const config = loadConfig();
    const log = createLogger();
    const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    cached = {
      config,
      log,
      db: new Db(documentClient, config.tableName),
      secrets: createSecrets({ ssm: new SSMClient({}), prefix: config.ssmPrefix, log }),
    };
  }
  return cached;
}

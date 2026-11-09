# Infrastructure

The whole AWS side of Mergescape is one CDK v2 stack written in TypeScript (Requirement 12): [`lib/mergescape-stack.ts`](lib/mergescape-stack.ts), started by [`bin/mergescape.ts`](bin/mergescape.ts). It replaced the SAM template of tasks 5 and 19 in task 25 with the same resources and the same IAM. At personal scale it runs inside the always-free allowances.

| Resource                                                                        | Construct (logical id prefix)        | Notes                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DynamoDB table `mergescape` (`mergescape-<stage>` when the stage is not `prod`) | `dynamodb.Table` (`Table`)           | PK/SK strings, provisioned 5/5, TTL on `ttl`, `GSI1` on `GSI1PK`/`GSI1SK` (projection INCLUDE, own 5/5). Retained when the stack is gone.                   |
| Lambda `ingest` + Function URL (auth NONE)                                      | `NodejsFunction` (`IngestFunction`)  | Node 22, 256 MB, 10 s, reserved concurrency 10. GitHub webhook target; the HMAC check is the security.                                                      |
| Lambda `api` + Function URL (auth NONE, CORS)                                   | `NodejsFunction` (`ApiFunction`)     | 60 s, reserved concurrency 5. CORS allows only the Pages origin. Also runs the Monday 00:05 UTC rollover (`{"action":"rollover"}`).                         |
| Log groups, 14-day retention                                                    | `logs.LogGroup` (`*LogGroup`)        | `/aws/lambda/mergescape-<stage>-ingest` and `-api`. Deleted with the stack.                                                                                 |
| EventBridge rule `cron(5 0 ? * MON *)`                                          | `events.Rule` (`RolloverRule`)       | Invokes `api` with `{"action":"rollover"}`; the only event source of either function.                                                                       |
| CloudFront distribution, cache policy, 404 function                             | `cloudfront.Distribution` (`Badge*`) | Origin is the `api` Function URL. `/badge/*` is cached 6 h (default TTL 21600, max 86400, nothing in the cache key); every other path is a 404 at the edge. |
| AWS Budgets, 1 USD and 10 USD monthly                                           | `budgets.CfnBudget` (`Budget*Usd`)   | E-mail to `alertEmail` at 100 % of actual spend. Budgets cover the whole AWS account, not only this stack.                                                  |

Outputs: `TableName`, `IngestUrl` (the GitHub App webhook URL), `ApiUrl` (the client's `VITE_API_ORIGIN`), `BadgeDomain`.

The template has no other resource (CDK's `AWS::CDK::Metadata` is switched off) and one parameter, `BootstrapVersion`, which CDK adds so that CloudFormation refuses to run in an account whose bootstrap stack is too old.

## IAM

Each function has its own role: the managed `AWSLambdaBasicExecutionRole` (CloudWatch Logs) plus one inline policy with exactly these statements, no wildcard action and no `Resource: "*"`.

| Function | `TableAccess`: DynamoDB on the table and `index/GSI1`                       | `RolloverScan`                             | `ReadSecrets`: SSM                                           | `DecryptSecrets`: KMS                                             |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `ingest` | `GetItem`, `PutItem`, `UpdateItem`, `Query`                                 | none                                       | `GetParameter`, `GetParameters` on `parameter${ssmPrefix}/*` | `Decrypt` on `key/*` only for alias `alias/aws/ssm`, only via SSM |
| `api`    | the same plus `DeleteItem`, `BatchWriteItem` (export and delete everything) | `Scan` on `index/GSI1` only (the rollover) | same                                                         | same                                                              |

The KMS key ARN has to be a wildcard because the id of the AWS managed key `alias/aws/ssm` is not known at synth time; the two conditions are what narrow it. The secrets must therefore be stored with the default key (omit `--key-id`). The only open principals in the stack are the Function URL permissions (`lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` with `InvokedViaFunctionUrl`), which is what an auth-NONE Function URL is.

## Where it deploys: the landing zone

Mergescape runs in its own AWS account, vended by the owner's landing zone (the `aws-landing-zone` repository), in **us-east-1**: the landing zone declares the account for that region only, and its bootstrap StackSet covers it. The landing zone has already done what this repository used to ask each operator to do:

- It **bootstrapped the account for CDK** in us-east-1 with the default qualifier `hnb659fds`. The bootstrap stack holds the staging bucket `cdk-hnb659fds-assets-<account>-us-east-1` and the roles `cdk-hnb659fds-{deploy,file-publishing,lookup,cfn-exec}-role-<account>-us-east-1`; the deploy and file-publishing roles trust the Infrastructure account's deploy role.
- It created the GitHub OIDC provider and the role **`lz-mergescape-deploy`** in the Infrastructure account (`324404179305`). Its trust requires the `sub` claim `repo:Andrew-Chemis@263069668/mergescape@1451656061:ref:refs/heads/main` (the immutable ids of the owner and of this repository) and the `job_workflow_ref` claim `Andrew-Chemis/mergescape/.github/workflows/deploy.yml@refs/heads/main`, and nothing else. Its only permission is `sts:AssumeRole` on `cdk-hnb659fds-*` roles in the Mergescape account, and the chained sessions CDK gets from it last at most one hour, which is ample for a deploy.

So the workflow holds no AWS permissions of its own and no keys: `cdk deploy` assumes the bootstrap deploy role, uploads the two Lambda bundles through the file-publishing role, and CloudFormation runs as the bootstrap execution role. Two consequences for this repository:

- The workflow file keeps its name and path, and the `stack` job never uses a GitHub `environment` (that would change the `sub` claim and the trust would stop matching).
- The account id is unknown until the landing zone vends the account, so it comes from the repository variable `AWS_ACCOUNT_ID`. The `stack` job is skipped while it is empty, and the stack takes it as the context value `accountId`. Without an account the stack is environment-agnostic: fine for `cdk synth`, but `cdk deploy` would then use the credentials' own account, so never deploy without it.

## Context

Everything configurable is CDK context: defaults in [`cdk.json`](cdk.json), overridden with `-c key=value`. Each value is validated at synth time with the pattern the SAM parameter had. Nothing is looked up in AWS, so `cdk synth` needs no credentials.

| Context          | Default                     | Meaning                                                                                                                                                                    | `deploy.yml` variable                                                              |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `accountId`      | empty                       | The account the landing zone vended; empty means environment-agnostic (synth only).                                                                                        | `AWS_ACCOUNT_ID` (required)                                                        |
| `region`         | `us-east-1`                 | Region to deploy to. The landing zone declares the account for `us-east-1` only, so leave it.                                                                              | `AWS_REGION`                                                                       |
| `pagesOrigin`    | `https://example.github.io` | Origin of the Pages site: scheme and host only. CORS and the handler's Origin check.                                                                                       | `PAGES_ORIGIN` (required)                                                          |
| `alertEmail`     | `alerts@example.com`        | Receives the Budgets alerts.                                                                                                                                               | `ALERT_EMAIL` (required)                                                           |
| `clientBasePath` | `/`                         | Path of the client on its Pages origin: `/` for a user site, `/<repository>/` for a project site. The api sends the browser to `pagesOrigin` plus this path after sign-in. | `CLIENT_BASE_PATH` (the workflow works it out from the repository name when empty) |
| `ssmPrefix`      | `/mergescape`               | Prefix of the five SecureString parameters.                                                                                                                                | `SSM_PREFIX`                                                                       |
| `stage`          | `prod`                      | Appears in resource names and `STAGE`. Stack and table are `mergescape` for `prod`, `mergescape-<stage>` otherwise.                                                        | `STAGE`                                                                            |

The two placeholders in `cdk.json` exist so that `cdk synth` and the tests run with no `-c`. When `accountId` is set, which is a deploy, the stack refuses them and asks for real values.

## Secrets: run once per account and region

Store the five parameters (App private key, webhook secret, client id, client secret, JWT key) as SecureString parameters under the prefix you deploy with (`ssmPrefix`, default `/mergescape`), in the account and region of the stack. They are put by hand with the landing zone's Admin entitlement for the Mergescape account (sign in with `aws login`; it is not an Identity Center permission set), because no pipeline may hold them. The functions read them at cold start and re-read the JWT key every 15 minutes, so rotating needs no redeploy: repeat the command with `--overwrite`.

```sh
SSM_PREFIX=/mergescape          # must equal the ssmPrefix context value
export AWS_REGION=us-east-1     # must equal the region you deploy to
export MSYS_NO_PATHCONV=1       # Git Bash on Windows only: stops it rewriting /mergescape/...

# 1. GitHub App private key (the .pem you generate on the App's settings page)
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/github-app-private-key" \
  --value file://github-app-private-key.pem

# 2. Webhook secret: generate it here, then paste the same value into the GitHub App's webhook settings
WEBHOOK_SECRET=$(openssl rand -hex 32); echo "$WEBHOOK_SECRET"
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/github-webhook-secret" \
  --value "$WEBHOOK_SECRET"

# 3. GitHub App client id (App settings page; not secret, but read the same way)
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/github-oauth-client-id" \
  --value '<client id>'

# 4. GitHub App OAuth client secret (App settings page, "Generate a new client secret")
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/github-oauth-client-secret" \
  --value '<client secret>'

# 5. Key that signs the session JWTs (HS256)
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/jwt-key" \
  --value "$(openssl rand -base64 48)"
```

## Deploy walkthrough

1. Have the landing zone vend the Mergescape account (it adds the app to its org config and deploys). It hands back the account id; the account is already CDK-bootstrapped and `lz-mergescape-deploy` can already reach it.
2. Register the GitHub App with the values in [`docs/github-app-manifest.json`](../../docs/github-app-manifest.json) (read-only `Pull requests` and `Metadata`, events `pull_request`, `pull_request_review`, `pull_request_review_comment`; GitHub sends `installation` and `installation_repositories` to every App on its own); note its client id and download the private key. Webhook URL and callback URL come in step 8.
3. Check Service Quotas in the new account (Lambda, Concurrent executions) as described under "Things to know", then run the five `aws ssm put-parameter` commands above, signed in with the Admin entitlement.
4. In the repository set the Actions variables `AWS_ACCOUNT_ID`, `PAGES_ORIGIN` (`https://<owner>.github.io`) and `ALERT_EMAIL`. Optional: `AWS_REGION` (default `us-east-1`), `SSM_PREFIX` (`/mergescape`), `STAGE` (`prod`), `CLIENT_BASE_PATH` (the client's path on Pages; the workflow uses `/` for a repository named `<owner>.github.io` and `/<repository>/` otherwise), `APP_SLUG` (the slug of your App, for the install link; default `mergescape`) and `AWS_DEPLOY_ROLE_ARN` (default `arn:aws:iam::324404179305:role/lz-mergescape-deploy`, the landing zone's role; set it only outside the landing zone, see below).
5. In Settings, Pages, set the source to "GitHub Actions".
6. Push to `main`. `.github/workflows/deploy.yml` assumes `lz-mergescape-deploy` through OIDC and runs `cdk deploy --require-approval never --all` with the variables as context. It bundles the two functions with esbuild, publishes the assets, creates or updates the stack, reads the outputs, builds the client with `VITE_API_ORIGIN` taken from `ApiUrl` and publishes it to Pages (skipped until the client produces `dist/index.html`).
7. Read the outputs: the `stack` job's summary lists them, or `aws cloudformation describe-stacks --stack-name mergescape --region us-east-1 --query "Stacks[0].Outputs"`.
8. In the GitHub App set the webhook URL to `IngestUrl` and the user authorization callback URL to `<ApiUrl>auth/callback`.
9. Check "Recent Deliveries" on the App's Advanced tab: a ping should return 200.
10. Open the Pages site and sign in. Confirm in the Billing console that the two budgets exist.

To deploy from a machine instead of Actions: `pnpm install`, then `pnpm --filter @mergescape/infra exec cdk deploy -c accountId=<account> -c pagesOrigin=https://<owner>.github.io -c alertEmail=<you@example.com>`, with credentials that may assume the account's `cdk-hnb659fds-*` roles. `cdk diff` takes the same arguments.

### Outside the landing zone (a fork in your own account)

The landing zone is the owner's, so a fork brings its own equivalents, and they are small because CDK does the heavy lifting through its bootstrap roles:

1. Bootstrap the account once: `pnpm --filter @mergescape/infra exec cdk bootstrap aws://<ACCOUNT_ID>/us-east-1` (the default qualifier `hnb659fds`, which the stack expects).
2. Create the OIDC provider once per account: `aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com`.
3. Create a role that only your `main` branch can assume. Trust policy (replace `<ACCOUNT_ID>`, `<OWNER>` and `<REPO>`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:ref:refs/heads/main"
           }
         }
       }
     ]
   }
   ```

   Its only permission is `sts:AssumeRole` on `arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-*`. That is far less than the CloudFormation, Lambda, IAM and CloudFront rights the SAM deploy role needed.

4. Set `AWS_ACCOUNT_ID` to your account and `AWS_DEPLOY_ROLE_ARN` to that role, then continue with the walkthrough from step 2.

## Local checks

```sh
pnpm --filter @mergescape/infra synth      # cdk synth --quiet --no-lookups -> dist/cdk.out/Mergescape.template.json
pnpm --filter @mergescape/infra validate   # synth, then cfn-lint and checkov when they are installed
pnpm --filter @mergescape/infra test       # assertions on the template, the esbuild bundles, the context, the snapshot
```

`validate` needs no AWS credentials: `pip install cfn-lint checkov` (CI pins `cfn-lint==1.60.0` and `checkov==3.4.3`) and it lints the synthesized template with [`.cfnlintrc.yaml`](.cfnlintrc.yaml) and [`.checkov.yaml`](.checkov.yaml). Extra arguments go to `cdk synth`, for example `validate -c stage=staging`.

`pnpm test` has these suites in `test/`:

- `stack.test.ts`: the 36 assertions of the old `validate.mjs`, made on the synthesized CloudFormation: the resource set, the table, provisioned throughput, TTL and the GSI projection, reserved concurrency, the exact CORS origin list, the exact IAM statements of each role, no wildcard action or `Resource: "*"`, `Scan` only for `api` and only on the index, 14-day retention, the cache policy, the budgets and the outputs. It also compares the whole template with the snapshot `test/__snapshots__/mergescape.template.json`; after an intended change regenerate it with `pnpm --filter @mergescape/infra exec vitest run -u` and read the diff.
- `bundling.test.ts`: runs esbuild for real and checks the commands (minified, `node22`, no source map, nothing external) and the two bundles (one `index.js` each, self-contained, exporting `handler`).
- `settings.test.ts`: context defaults, validation and overrides, and that the stack targets the vended account and the `hnb659fds` bootstrap roles in us-east-1 with no lookups.
- `csp.test.ts` and `release.test.ts`: the client's CSP and the release-readiness facts of task 19.

The Lambda code is bundled by `NodejsFunction` running the esbuild that is a pinned devDependency of this package (`pnpm exec esbuild`, so run `cdk` through `pnpm exec`); there is no Docker step. The entry points are `packages/backend/src/handlers/ingest.ts` and `api.ts`, esbuild follows the pnpm workspace links to `@mergescape/shared`, and the AWS SDK is bundled so that the Lambda runs the SDK version pinned in the catalog.

## Things to know

- **Check the Lambda concurrency quota before the first deploy.** Lambda always keeps 100 executions unreserved, so the account's quota for concurrent executions must be at least 100 and, for the 10 + 5 reserved here, in fact 115. A brand-new account can still be at 10; the usual default of 1000 is fine. Look in Service Quotas (Lambda, Concurrent executions) and request an increase first, or the deploy fails on the function.
- **The table survives `cdk destroy`** (`RemovalPolicy.RETAIN`) so player data is never lost by accident. Redeploying a deleted stack with the same name then fails on the existing table; delete the table by hand or deploy another `stage`. The log groups are deleted with the stack.
- **`GSI1` projects only `login`, `level`, `xp`, `renown`, `vocation`, `pinned_feats` and `old_coin`** (`INCLUDE`, the constant `GSI1_PROJECTED_ATTRIBUTES` in the stack): the badge reads them from the index (the pinned Feats and the Old Coin came with task 22), and the rollover scan needs only the keys. A new attribute goes into the constant, the stack test and the snapshot together. DynamoDB cannot change a deployed index's projection in place, so a table deployed with another projection needs the index dropped and re-created in two deploys.
- **The `api` function has a 60 s timeout** because the Monday rollover walks every profile in it. The scan is paged (100 per page) and four profiles are rolled at a time, so a few hundred players take seconds; at 5 write units the SDK retries throttled writes with back-off.
- **Lint.** CI runs `cfn-lint` and `checkov` on the synthesized template. `cfn-lint` ignores one warning, `W3005` (CDK writes the function's role into `DependsOn` next to its `Role` property on every Lambda it makes). `checkov` skips ten checks, each explained beside its entry in [`.checkov.yaml`](.checkov.yaml); they are skipped by design because each one costs money or does not apply to a public Function URL: no point-in-time recovery, no customer-managed KMS keys for the table, log groups and Lambda environment, no Lambda DLQ or VPC, auth-NONE Function URLs (HMAC and JWT protect them), no CloudFront access logging or WAF, and the default CloudFront certificate's TLS floor. The IAM, CORS and concurrency checks pass.
- **`clientBasePath`** (default `/`) is where the client lives on its Pages origin. The api sends the browser to `pagesOrigin` plus this path after sign-in, so a project site (`https://<owner>.github.io/<repository>/`) needs `/<repository>/`; `deploy.yml` works it out from the repository name.
- **From the SAM stack.** The CDK stack has different logical ids and is meant for a new account, so nothing is imported and the table starts empty. A deployment that has data in a SAM-built table can copy it with a DynamoDB export and import; the item layout did not change.

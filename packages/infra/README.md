# Infrastructure

`template.yaml` is the whole AWS side of Mergescape as one SAM stack (Requirement 12). At personal scale it runs inside the always-free allowances.

| Resource                                                                        | Logical id                      | Notes                                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| DynamoDB table `mergescape` (`mergescape-<Stage>` when the stage is not `prod`) | `Table`                         | PK/SK strings, provisioned 5/5, TTL on `ttl`, `GSI1` on `GSI1PK`/`GSI1SK` (projection ALL, own 5/5). Kept when the stack is deleted. |
| Lambda `ingest` + Function URL (auth NONE)                                      | `IngestFunction`                | Node 22, 256 MB, 10 s, reserved concurrency 10. GitHub webhook target; the HMAC check is the security.                               |
| Lambda `api` + Function URL (auth NONE, CORS)                                   | `ApiFunction`                   | Reserved concurrency 5. CORS allows only `PagesOrigin`. Also runs the Monday 00:05 UTC rollover (`{"action":"rollover"}`).           |
| Log groups, 14-day retention                                                    | `IngestLogGroup`, `ApiLogGroup` |                                                                                                                                      |
| CloudFront distribution                                                         | `BadgeDistribution`             | Origin is the `api` Function URL. `/badge/*` is cached 6 h (`BadgeCachePolicy`); every other path is a 404 at the edge.              |
| AWS Budgets, 1 USD and 10 USD monthly                                           | `Budget1Usd`, `Budget10Usd`     | E-mail to `AlertEmail` at 100 % of actual spend. Budgets cover the whole AWS account, not only this stack.                           |

Outputs: `TableName`, `IngestUrl` (the GitHub App webhook URL), `ApiUrl` (the client's `VITE_API_ORIGIN`), `BadgeDomain`.

## IAM

Each function gets one inline policy on top of the managed `AWSLambdaBasicExecutionRole` (CloudWatch Logs).

| Function | DynamoDB on the table and `index/GSI1`                                  | SSM                                                          | KMS                                                               |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `ingest` | `GetItem`, `PutItem`, `UpdateItem`, `Query`                             | `GetParameter`, `GetParameters` on `parameter${SsmPrefix}/*` | `Decrypt` on `key/*` only for alias `alias/aws/ssm`, only via SSM |
| `api`    | the same plus `DeleteItem`, `BatchWriteItem` (export/delete everything) | same                                                         | same                                                              |

The KMS key ARN has to be a wildcard because the id of the AWS managed key `alias/aws/ssm` is not known at template time; the two conditions are what narrow it. The secrets must therefore be stored with the default key (omit `--key-id`).

## Secrets: run once per account and region

Store the four secrets as SecureString parameters under the prefix you deploy with (`SsmPrefix`, default `/mergescape`). The functions read them at cold start and re-read the JWT key every 15 minutes, so rotating needs no redeploy: repeat the command with `--overwrite`.

```sh
SSM_PREFIX=/mergescape          # must equal the SsmPrefix stack parameter
export AWS_REGION=us-east-1     # must equal the region you deploy to
export MSYS_NO_PATHCONV=1       # Git Bash on Windows only: stops it rewriting /mergescape/...

# 1. GitHub App private key (the .pem you generate on the App's settings page)
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/github-app-private-key" \
  --value file://github-app-private-key.pem

# 2. Webhook secret: generate it here, then paste the same value into the GitHub App's webhook settings
WEBHOOK_SECRET=$(openssl rand -hex 32); echo "$WEBHOOK_SECRET"
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/github-webhook-secret" \
  --value "$WEBHOOK_SECRET"

# 3. GitHub App OAuth client secret (App settings page, "Generate a new client secret")
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/github-oauth-client-secret" \
  --value '<client secret>'

# 4. Key that signs the session JWTs (HS256)
aws ssm put-parameter --type SecureString --name "$SSM_PREFIX/jwt-key" \
  --value "$(openssl rand -base64 48)"
```

## GitHub Actions to AWS: OIDC role, no stored keys

Create the identity provider once per account, then a role that only your `main` branch can assume.

```sh
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com
```

Trust policy of the deploy role (replace `<ACCOUNT_ID>`, `<OWNER>` and `<REPO>`):

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

The role needs to manage CloudFormation stacks and what the template creates: CloudFormation, S3 (the bucket `sam deploy --resolve-s3` creates), Lambda, IAM roles for the two functions, DynamoDB, CloudWatch Logs, EventBridge rules, CloudFront (distribution, cache policy, function) and Budgets. It is the most powerful credential in the setup, which is why the trust policy pins it to `main`.

## Deploy walkthrough

1. Register the GitHub App (read-only `Pull requests` and `Metadata`, events `pull_request`, `pull_request_review`, `pull_request_review_comment`); note its client id and download the private key. Webhook URL and callback URL come in step 8.
2. Run the four `aws ssm put-parameter` commands above.
3. Create the OIDC provider and the deploy role above.
4. In the repository set the Actions variables `AWS_DEPLOY_ROLE_ARN`, `PAGES_ORIGIN` (`https://<owner>.github.io`) and `ALERT_EMAIL`. Optional: `AWS_REGION` (default `us-east-1`), `STACK_NAME` (`mergescape`), `SSM_PREFIX` (`/mergescape`), `STAGE` (`prod`).
5. In Settings, Pages, set the source to "GitHub Actions".
6. Push to `main`. `.github/workflows/deploy.yml` validates the template, runs `sam build` and `sam deploy`, builds the client with `VITE_API_ORIGIN` taken from the `ApiUrl` output and publishes it to Pages (skipped until the client produces `dist/index.html`).
7. Read the outputs: `aws cloudformation describe-stacks --stack-name mergescape --query "Stacks[0].Outputs"`.
8. In the GitHub App set the webhook URL to `IngestUrl` and the user authorization callback URL to `<ApiUrl>auth/callback`.
9. Check "Recent Deliveries" on the App's Advanced tab: a ping should return 200.
10. Open the Pages site and sign in. Confirm in the Billing console that the two budgets exist.

To deploy from a machine instead of Actions, install the SAM CLI, run `pnpm install`, then in `packages/infra`: `pnpm exec sam build` and `sam deploy --guided` (answer with the same parameters as the variables above).

## Local checks

```sh
pnpm --filter @mergescape/infra validate    # structural checks, then `sam validate --lint` if SAM is installed
pnpm --filter @mergescape/infra sam:build   # sam build; esbuild is the pinned devDependency of this package
```

`validate` asserts the resource set, the table, the function settings and the exact IAM statements above, and fails on any difference.

Why `CodeUri` is `../` (the `packages/` directory) and the entry points read `backend/src/handlers/*.ts`: when the code directory contains a `package.json`, SAM runs `npm install` there, and npm cannot read pnpm's `catalog:` and `workspace:` specifiers. `packages/` has none, so SAM runs esbuild in place and esbuild follows the workspace links to `@mergescape/shared`.

## Things to know

- **Reserved concurrency needs headroom.** Lambda keeps 100 executions unreserved. A brand-new account whose total concurrency quota is still 10 cannot reserve 10 + 5; request a quota increase or the deploy fails on the function.
- **The table survives `sam delete`** (`DeletionPolicy: Retain`) so player data is never lost by accident. Redeploying a deleted stack with the same name then fails on the existing table; delete the table by hand or deploy another `Stage`.
- **`Projection: ALL` on `GSI1`** rewrites the index entry on every profile update. Switch to `INCLUDE` with the badge fields if write capacity gets tight.
- **checkov** reports, by design: no point-in-time recovery, no customer-managed KMS keys for the table and log groups, no Lambda DLQ or VPC, no CloudFront access logging or WAF, and the default CloudFront certificate's TLS floor. Each one costs money or does not apply to a public function URL; the IAM, CORS and concurrency checks pass.

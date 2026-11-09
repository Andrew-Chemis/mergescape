# AWS account request: mergescape

Draft of the pull request to open against the `aws-landing-zone` repository. The landing zone's own request format (Control Tower / Account Factory, AFT, or Organizations + Terraform) is unknown from here, so the fields below cover what each of those typically needs; copy the relevant ones into that repo's template.

## Request

| Field                 | Value                                                                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account name          | `mergescape-prod`                                                                                                                                                                                                                                                          |
| Purpose               | Hosts the Mergescape game backend: 2 Lambda functions (Function URLs), 1 DynamoDB table (provisioned 5/5), 1 CloudFront distribution for badges, SSM parameters, EventBridge schedule, CloudWatch logs, 2 AWS Budgets. See `packages/infra/template.yaml` in `mergescape`. |
| Environment           | Production (a separate `mergescape-dev` can follow if the landing zone prefers per-env accounts)                                                                                                                                                                           |
| Organizational unit   | Workloads / Sandbox-Prod (whichever the landing zone uses for low-risk personal workloads)                                                                                                                                                                                 |
| Root email            | `aws+mergescape-prod@<your-domain>` (alias to the maintainer)                                                                                                                                                                                                              |
| Owner                 | Andrew Chemis (GitHub `Andrew-Chemis` / `lowpast`)                                                                                                                                                                                                                         |
| Regions               | `us-east-1` only (CloudFront requires us-east-1 for certificates if a custom domain is added later)                                                                                                                                                                        |
| Expected monthly cost | $0 at launch (always-free tier); ≈ $15–25/month at 10,000 users. Budgets at $1 and $10 are created by the stack.                                                                                                                                                           |
| Data classification   | Low. Pull-request metadata only (numeric ids, counts, timestamps). No code, no secrets beyond the GitHub App private key and webhook secret, which live in SSM SecureString.                                                                                               |
| Compliance needs      | None beyond baseline guardrails. No PII other than GitHub numeric ids and logins.                                                                                                                                                                                          |
| Networking            | No VPC required. All services are regional/public endpoints.                                                                                                                                                                                                               |
| Identity              | IAM Identity Center permission set `AdministratorAccess` for the owner; a deploy role assumed via GitHub Actions OIDC from `repo:<owner>/mergescape:ref:refs/heads/main` (trust policy in `packages/infra/README.md`).                                                     |
| Service quotas        | Lambda unreserved concurrency ≥ 100 so that reserved concurrency 10 + 5 can be set (new accounts sometimes start at 10; request a raise to 1,000).                                                                                                                         |
| Tags                  | `project=mergescape`, `owner=andrew-chemis`, `env=prod`, `cost-center=personal`                                                                                                                                                                                            |
| Guardrail exceptions  | None requested.                                                                                                                                                                                                                                                            |
| Decommission plan     | Delete the SAM stack; the DynamoDB table has `DeletionPolicy: Retain` and is removed manually after export.                                                                                                                                                                |

## Checklist for the landing-zone PR

- [ ] Account vended into the chosen OU
- [ ] SSO access granted to the owner
- [ ] GitHub OIDC provider created in the account (`token.actions.githubusercontent.com`)
- [ ] Deploy role created with the trust policy from `packages/infra/README.md` and the permissions needed by `sam deploy` (CloudFormation, Lambda, DynamoDB, CloudFront, IAM role creation for the two functions, SSM read, Budgets, Logs, Events, S3 for the SAM artifact bucket)
- [ ] Lambda concurrency quota confirmed ≥ 100
- [ ] Repository variables set in `mergescape`: `AWS_DEPLOY_ROLE_ARN`, `PAGES_ORIGIN`, `ALERT_EMAIL`, optionally `AWS_REGION`, `STACK_NAME`, `SSM_PREFIX`, `STAGE`

## Blocked on

Access to the `aws-landing-zone` repository from this machine (no `gh` CLI, no stored GitHub credentials, repository not reachable anonymously). Once a clone path or credentials are available, this document is turned into that repository's request format and opened as a PR.

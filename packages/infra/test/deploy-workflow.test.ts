/**
 * Task 25 (Requirement 12.7): `deploy.yml` deploys through the landing zone and nothing else. The role's
 * trust is pinned to this repository, to `refs/heads/main` and to this workflow file, and the role can only
 * assume the CDK bootstrap roles, so these tests keep the workflow inside what the trust allows.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const deploy = readFileSync(root('.github/workflows/deploy.yml'), 'utf8');
const ci = readFileSync(root('.github/workflows/ci.yml'), 'utf8');

/** The text of one job: from its key to the next job (or the end). */
function job(name: string): string {
  const start = deploy.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const rest = deploy.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const stack = job('stack');
const pages = job('pages');

describe('deploy.yml, the stack job', () => {
  it('lives at the path the landing zone trusts and runs after CI completes on main, or by hand', () => {
    expect(existsSync(root('.github/workflows/deploy.yml'))).toBe(true);
    const triggers = deploy.slice(deploy.indexOf('\non:\n'), deploy.indexOf('\npermissions:'));
    expect(triggers).toMatch(
      /^\non:\n {2}workflow_run:\n {4}workflows: \[CI\].*\n {4}types: \[completed\]\n {4}branches: \[main\]\n {2}workflow_dispatch:\n$/,
    );
    // It must not run on the push itself, in parallel with CI, nor on a pull request.
    expect(triggers).not.toMatch(/^ {2}push:/m);
    expect(triggers).not.toContain('pull_request');
    // `workflows: [CI]` names the workflow in ci.yml.
    expect(ci).toMatch(/^name: CI$/m);
  });

  it('deploys only a CI run that succeeded for a push to main, or a manual run', () => {
    const condition = stack
      .slice(stack.indexOf('    if:'), stack.indexOf('    runs-on:'))
      .replace(/\s+/g, ' ');
    expect(condition).toContain("vars.AWS_ACCOUNT_ID != ''");
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
    expect(condition).toContain("github.event.workflow_run.conclusion == 'success'");
    // A scheduled CI run and a pull request from a fork's own main also match `branches: [main]`.
    expect(condition).toContain("github.event.workflow_run.event == 'push'");
    expect(condition).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it('checks out the commit CI tested, in both jobs, not the tip of main', () => {
    for (const text of [stack, pages]) {
      expect(text).toMatch(
        /uses: actions\/checkout@v4\n\s+with:\n(?:\s+#.*\n)*\s+ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/,
      );
    }
  });

  it('is skipped while AWS_ACCOUNT_ID is empty', () => {
    expect(stack).toMatch(/\n {4}if: >-\n {6}\$\{\{ vars\.AWS_ACCOUNT_ID != '' &&/);
  });

  it('assumes lz-mergescape-deploy in the Infrastructure account through OIDC', () => {
    expect(stack).toMatch(/id-token: write/);
    expect(stack).toMatch(/uses: aws-actions\/configure-aws-credentials@v6/);
    expect(stack).toContain('arn:aws:iam::324404179305:role/lz-mergescape-deploy');
    expect(stack).toContain('vars.AWS_DEPLOY_ROLE_ARN ||');
  });

  it('uses no GitHub environment, which would change the sub claim the trust matches', () => {
    expect(stack).not.toMatch(/^\s+environment:/m);
  });

  it('holds no AWS keys and reads no secret', () => {
    expect(deploy).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/);
    expect(deploy).not.toContain('secrets.');
  });

  it('deploys with cdk through the bootstrap roles, with the variables as context', () => {
    expect(stack).toContain(
      'pnpm --filter @mergescape/infra exec cdk deploy --require-approval never --all',
    );
    for (const context of [
      'accountId="$ACCOUNT_ID"',
      'region="$AWS_REGION"',
      'pagesOrigin="$PAGES_ORIGIN"',
      'alertEmail="$ALERT_EMAIL"',
      'clientBasePath="$base"',
      'ssmPrefix="$SSM_PREFIX"',
      'stage="$STAGE"',
    ]) {
      expect(stack, context).toContain(`-c ${context}`);
    }
    expect(stack).toContain('ACCOUNT_ID: ${{ vars.AWS_ACCOUNT_ID }}');
    expect(deploy).toContain("AWS_REGION: ${{ vars.AWS_REGION || 'us-east-1' }}");
    // Nothing of SAM is left.
    expect(deploy).not.toMatch(/\bsam\b|SAM_CLI|STACK_NAME/);
  });

  it('refuses to deploy without the origin and the alert address', () => {
    expect(stack).toContain('for name in PAGES_ORIGIN ALERT_EMAIL');
  });

  it('lowercases PAGES_ORIGIN before it reaches cdk: the Lambdas compare it with new URL(x).origin', () => {
    const lower = stack.indexOf('PAGES_ORIGIN="${PAGES_ORIGIN,,}"');
    expect(lower).toBeGreaterThan(-1);
    expect(lower).toBeLessThan(stack.indexOf('exec cdk deploy'));
  });

  it('hands the API origin on as a job output, from the stack outputs', () => {
    expect(stack).toContain('api_origin: ${{ steps.outputs.outputs.api_origin }}');
    expect(stack).toContain('--outputs-file "$RUNNER_TEMP/outputs.json"');
    expect(stack).toContain('.ApiUrl');
  });
});

describe('deploy.yml, the pages job', () => {
  it('waits for the stack and builds the client against its API origin', () => {
    expect(pages).toContain('needs: stack');
    expect(pages).toContain('VITE_API_ORIGIN: ${{ needs.stack.outputs.api_origin }}');
    expect(pages).toContain('name: github-pages');
  });
});

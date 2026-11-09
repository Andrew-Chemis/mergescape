// `pnpm --filter @mergescape/infra validate`: synthesizes the stack and lints the template it writes.
//
// 1. Always: `cdk synth --quiet --no-lookups` (no AWS credentials needed; extra arguments, such as `-c stage=staging`,
//    are passed through). It fails on any construct error or invalid context value.
// 2. When installed: cfn-lint (settings in .cfnlintrc.yaml) and checkov (settings in .checkov.yaml, which
//    lists the checks skipped by design) on the synthesized template. Otherwise prints "<tool> not
//    installed" and relies on the assertions in test/ alone. CI installs both and runs them as steps of
//    their own.
//
// The assertions on the template are the tests: `pnpm --filter @mergescape/infra test`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = join('dist', 'cdk.out', 'Mergescape.template.json');
// Windows resolves `cdk`, `cfn-lint` and `checkov` through cmd shims.
const shell = process.platform === 'win32';

const run = (command, args) => spawnSync(command, args, { cwd: root, stdio: 'inherit', shell });
const installed = (command) =>
  spawnSync(command, ['--version'], { cwd: root, stdio: 'ignore', shell }).status === 0;

const synth = run('cdk', ['synth', '--quiet', '--no-lookups', ...process.argv.slice(2)]);
if (synth.status !== 0 || !existsSync(join(root, template))) {
  console.error('cdk synth failed');
  process.exit(1);
}
console.log(`cdk synth: ${template}`);

let failed = false;
const lint = (name, args) => {
  if (!installed(name)) {
    console.log(`${name} not installed (pip install ${name})`);
    return;
  }
  console.log(`${name}:`);
  if (run(name, args).status !== 0) failed = true;
};

lint('cfn-lint', []);
lint('checkov', ['--config-file', '.checkov.yaml', '-f', template]);

process.exit(failed ? 1 : 0);

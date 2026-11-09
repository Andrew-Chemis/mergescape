// Runs `sam validate --lint` when the SAM CLI is installed; otherwise only says it is missing.
import { spawnSync } from 'node:child_process';

const probe = spawnSync('sam', ['--version'], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
});

if (probe.error || probe.status !== 0) {
  console.log('sam not installed');
} else {
  const result = spawnSync('sam', ['validate', '--lint'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = result.status ?? 1;
}

/**
 * Task 25: the two Lambda bundles. SAM ran esbuild over `backend/src/handlers/{ingest,api}.ts` with
 * `Minify: true, Sourcemap: false, Target: node22`; the CDK app must do the same. This test lets the stack
 * run esbuild for real, records the commands, and inspects the bundles in the cloud assembly.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { synth } from './synth';

const nodeRequire = createRequire(import.meta.url);
// aws-cdk-lib is CommonJS and calls `child_process.spawnSync` on the shared module object, so a spy sees it.
const childProcess = nodeRequire('node:child_process') as { spawnSync: typeof spawnSync };

/** `pnpm exec esbuild` finds the binary of this package's pinned devDependency through PATH. */
const INFRA_BIN = fileURLToPath(new URL('../node_modules/.bin', import.meta.url));
const BACKEND = fileURLToPath(new URL('../../backend/', import.meta.url));
const OPTIONAL_SIGNERS = ['@aws-sdk/signature-v4-crt', '@aws-sdk/signature-v4a'];

interface AssetManifest {
  files: Record<string, { source: { path: string; packaging: string } }>;
}

let outdir = '';
let commands: string[] = [];
let bundles: string[] = [];
const originalPath = process.env['PATH'];

beforeAll(() => {
  process.env['PATH'] = `${INFRA_BIN}${delimiter}${originalPath ?? ''}`;
  outdir = mkdtempSync(join(tmpdir(), 'mergescape-cdk-'));
  const spy = vi.spyOn(childProcess, 'spawnSync');
  try {
    const { app } = synth(undefined, { bundle: true, outdir });
    const assembly = app.synth();
    commands = spy.mock.calls
      .map(([command, args]) =>
        [command, ...(Array.isArray(args) ? (args as string[]) : [])].join(' '),
      )
      .filter((line) => line.includes('esbuild') && line.includes('--bundle'));
    const manifest = JSON.parse(
      readFileSync(join(assembly.directory, 'Mergescape.assets.json'), 'utf8'),
    ) as AssetManifest;
    bundles = Object.values(manifest.files)
      .filter((file) => file.source.packaging === 'zip')
      .map((file) => join(assembly.directory, file.source.path));
  } finally {
    spy.mockRestore();
  }
}, 180_000);

afterAll(() => {
  process.env['PATH'] = originalPath;
  if (outdir) rmSync(outdir, { recursive: true, force: true });
});

describe('esbuild runs once per handler with the SAM settings', () => {
  it('bundles ingest.ts and api.ts, minified, for node22, with no source map', () => {
    expect(commands).toHaveLength(2);
    for (const [index, handler] of ['ingest', 'api'].entries()) {
      const command = commands[index] ?? '';
      expect(command).toMatch(new RegExp(`backend[\\\\/]src[\\\\/]handlers[\\\\/]${handler}\\.ts`));
      expect(command).toContain('--bundle');
      expect(command).toContain('--target=node22');
      expect(command).toContain('--platform=node');
      expect(command).toContain('--minify');
      expect(command).not.toContain('sourcemap');
      // The AWS SDK is bundled too, so nothing is left external for the runtime to resolve.
      expect(command).not.toContain('--external');
    }
  });
});

describe('the bundles in the cloud assembly', () => {
  it('has two, each one file named index.js with no source map beside it', () => {
    expect(bundles).toHaveLength(2);
    for (const directory of bundles) {
      expect(readdirSync(directory)).toEqual(['index.js']);
    }
  });

  it('are minified, self-contained and export the handler', () => {
    for (const directory of bundles) {
      const code = readFileSync(join(directory, 'index.js'), 'utf8');
      // Minified output is a few long lines; unminified source averages a few dozen characters a line.
      expect(code.length / code.split('\n').length).toBeGreaterThan(500);
      expect(code).not.toContain('sourceMappingURL');
      // The SDK and `@mergescape/shared` are inside the file. What is left for the runtime to resolve is
      // Node's own modules and the two optional SigV4a signers the SDK loads inside a try/catch.
      const external = [...code.matchAll(/require\(["']([^"']+)["']\)/g)]
        .map((match) => match[1] ?? '')
        .filter((name) => !name.startsWith('node:') && !OPTIONAL_SIGNERS.includes(name));
      expect(external).toEqual([]);
      expect(nodeRequire(join(directory, 'index.js'))).toHaveProperty(
        'handler',
        expect.any(Function),
      );
    }
  });
});

describe('the sources the bundles come from', () => {
  it('exist', () => {
    expect(existsSync(join(BACKEND, 'src', 'handlers', 'ingest.ts'))).toBe(true);
    expect(existsSync(join(BACKEND, 'src', 'handlers', 'api.ts'))).toBe(true);
  });
});

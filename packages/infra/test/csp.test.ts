/**
 * Task 19: the CSP of the built client is exactly Requirement 12.6. The client is built the way
 * `deploy.yml` builds it (`VITE_API_ORIGIN` from the stack's `ApiUrl` output, production mode) into a
 * temporary directory, and the `<meta>` tag in the resulting `index.html` is compared with the policy as
 * the requirement spells it, so a change to the plugin or to the page that weakens it fails here.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLIENT = fileURLToPath(new URL('../../client/', import.meta.url));

/** The `ApiUrl` output ends with a slash; the workflow strips it, but the build must cope either way. */
const API_URL = 'https://abc123xyz.lambda-url.us-east-1.on.aws/';
const API_ORIGIN = 'https://abc123xyz.lambda-url.us-east-1.on.aws';

/** Requirement 12.6, with `{api-origin}` filled in. */
const REQUIREMENT_12_6 = [
  `default-src 'self'`,
  `connect-src ${API_ORIGIN}`,
  `img-src 'self' data:`,
  `font-src https://fonts.gstatic.com`,
  `style-src 'self' https://fonts.googleapis.com`,
].join('; ');

let outDir = '';
let html = '';

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'mergescape-client-'));
  const previous = process.env['VITE_API_ORIGIN'];
  process.env['VITE_API_ORIGIN'] = API_URL;
  try {
    await build({
      root: CLIENT,
      configFile: join(CLIENT, 'vite.config.ts'),
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    if (previous === undefined) {
      delete process.env['VITE_API_ORIGIN'];
    } else {
      process.env['VITE_API_ORIGIN'] = previous;
    }
  }
  html = readFileSync(join(outDir, 'index.html'), 'utf8');
});

afterAll(() => {
  if (outDir) {
    rmSync(outDir, { recursive: true, force: true });
  }
});

describe('the built client (Requirement 12.6)', () => {
  it('carries exactly one CSP meta tag, and its policy is the one the requirement spells out', () => {
    const tags = [
      ...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/g),
    ];
    expect(tags).toHaveLength(1);
    expect(tags[0]?.[1]).toBe(REQUIREMENT_12_6);
    expect(html.match(/Content-Security-Policy/gi)).toHaveLength(2); // the tag and the comment about it
  });

  it('applies the policy before anything that loads a resource', () => {
    const policy = html.indexOf('http-equiv="Content-Security-Policy"');
    for (const loader of ['<script', '<link', '<img', '<iframe', '<style']) {
      const index = html.indexOf(loader);
      if (index !== -1) {
        expect(policy, `the policy must come before ${loader}`).toBeLessThan(index);
      }
    }
  });

  it('loads only same-origin files and the two Google Fonts hosts, with nothing inline', () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/<style/);
    expect(html).not.toMatch(/\sstyle\s*=/);
    expect(html).not.toMatch(/\son\w+\s*=/);
    const references = [...html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    expect(references.length).toBeGreaterThanOrEqual(5);
    for (const reference of references) {
      const external = /^https?:\/\//.test(reference);
      expect(
        !external || /^https:\/\/fonts\.(?:googleapis|gstatic)\.com[/?]?/.test(reference),
        `${reference} is not same-origin or Google Fonts`,
      ).toBe(true);
      if (!external) {
        expect(reference.startsWith('./assets/'), `${reference} is not a built asset`).toBe(true);
        expect(existsSync(join(outDir, reference)), `${reference} was not built`).toBe(true);
      }
    }
  });

  it('keeps the stylesheet free of imports and remote urls', () => {
    const href = /<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+\.css)"/.exec(
      html,
    )?.[1];
    expect(href).toBeDefined();
    const css = readFileSync(join(outDir, href ?? ''), 'utf8');
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(\s*["']?https?:/);
  });
});

describe('the deploy wiring', () => {
  const deploy = readFileSync(
    fileURLToPath(new URL('../../../.github/workflows/deploy.yml', import.meta.url)),
    'utf8',
  );

  it("builds the client with the stack's ApiUrl as VITE_API_ORIGIN, so connect-src is the real api", () => {
    expect(deploy).toContain('VITE_API_ORIGIN: ${{ needs.stack.outputs.api_origin }}');
    expect(deploy).toContain("Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue");
    // The workflow strips the trailing slash; a CSP source with a path would not match a request.
    expect(deploy).toContain('api_origin=${api_url%/}');
  });
});

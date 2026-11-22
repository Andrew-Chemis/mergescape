import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import { buildCsp, cspPlugin } from './csp';

describe('buildCsp (Requirement 12.6)', () => {
  it('is the specified policy, with connect-src from the api origin', () => {
    expect(buildCsp('https://abc123.lambda-url.us-east-1.on.aws')).toBe(
      [
        "default-src 'self'",
        'connect-src https://abc123.lambda-url.us-east-1.on.aws',
        "img-src 'self' data:",
        'font-src https://fonts.gstatic.com',
        "style-src 'self' https://fonts.googleapis.com",
      ].join('; '),
    );
  });

  it('keeps only the origin of whatever URL it is given', () => {
    expect(buildCsp('https://api.example/prod/?x=1')).toContain('connect-src https://api.example;');
    expect(buildCsp(' http://localhost:3000/ ')).toContain('connect-src http://localhost:3000;');
  });

  it("falls back to 'self' without an api origin (the fixture-only build)", () => {
    expect(buildCsp(undefined)).toContain("connect-src 'self';");
    expect(buildCsp('')).toContain("connect-src 'self';");
    expect(buildCsp('   ')).toContain("connect-src 'self';");
  });

  it('fails the build on a bad origin instead of shipping a wrong policy', () => {
    expect(() => buildCsp('not a url')).toThrow();
    expect(() => buildCsp('ftp://files.example')).toThrow(/http\(s\)/);
  });

  it('never allows inline scripts, inline styles, eval or wildcard sources', () => {
    const policy = buildCsp('https://api.example');
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
    expect(policy).not.toContain('script-src');
  });
});

describe('cspPlugin', () => {
  const html =
    '<!doctype html><html><head>\n    <meta charset="UTF-8" />\n    <title>x</title></head></html>';

  function inject(source: string, origin: string | undefined): string {
    const plugin = cspPlugin(origin);
    const hook = plugin.transformIndexHtml as { handler: (html: string) => string };
    return hook.handler(source);
  }

  it('applies to builds only, so the dev server keeps working', () => {
    expect(cspPlugin('https://api.example').apply).toBe('build');
  });

  it('injects the policy as a meta tag right after the charset declaration', () => {
    const out = inject(html, 'https://api.example');
    expect(out).toContain(
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${buildCsp('https://api.example')}" />`,
    );
    expect(out.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('falls back to the head when there is no charset meta', () => {
    expect(inject('<html><head><title>x</title></head></html>', undefined)).toContain(
      '<head>\n    <meta http-equiv="Content-Security-Policy"',
    );
  });
});

describe('index.html', () => {
  it('declares its language, viewport and dark colour scheme', () => {
    expect(indexHtml).toContain('<html lang="en">');
    expect(indexHtml).toContain('name="viewport"');
    expect(indexHtml).toContain('<meta name="color-scheme" content="dark" />');
  });

  it('loads the fonts from Google Fonts, the only third party the CSP allows', () => {
    const links = [...indexHtml.matchAll(/https?:\/\/[^/"'\s]+/g)].map((match) => match[0]);
    expect(new Set(links)).toEqual(
      new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']),
    );
    for (const family of ['Pixelify+Sans', 'IBM+Plex+Sans', 'IBM+Plex+Mono']) {
      expect(indexHtml).toContain(family);
    }
  });

  it('has no inline script or style, which style-src and default-src would block', () => {
    expect(indexHtml).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(indexHtml).not.toMatch(/<style/);
    expect(indexHtml).not.toMatch(/\sstyle=/);
  });
});

describe('components under the CSP', () => {
  // `style="..."` in a template is an inline style attribute, which `style-src 'self'` blocks.
  // Dynamic values use Svelte's `style:prop={value}` directives, which go through the CSSOM.
  const sources = import.meta.glob('../src/**/*.svelte', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('finds the components to scan', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });

  it.each(Object.entries(sources))(
    '%s has no inline style attribute and no {@html}',
    (_path, source) => {
      const markup = source
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '');
      expect(markup).not.toMatch(/\sstyle\s*=/);
      expect(markup).not.toContain('{@html');
    },
  );
});

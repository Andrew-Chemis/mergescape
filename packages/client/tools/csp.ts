/**
 * Content-Security-Policy for the built client (Requirement 12.6):
 *
 *   default-src 'self'; connect-src {api-origin}; img-src 'self' data:;
 *   font-src https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com
 *
 * `connect-src` is the api origin from `VITE_API_ORIGIN` at build time (only `'self'` without one).
 * The policy goes into a `<meta>` tag, so it is injected into the built `index.html` only: the dev
 * server needs inline styles and a websocket that this policy would block.
 */
import type { Plugin } from 'vite';

/** The CSP string for a given api origin (any URL; only its origin is used). */
export function buildCsp(apiOrigin: string | undefined): string {
  let connect = "'self'";
  const raw = apiOrigin?.trim();
  if (raw) {
    const url = new URL(raw); // throws on garbage: a bad VITE_API_ORIGIN should fail the build
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`VITE_API_ORIGIN must be an http(s) URL, got "${raw}"`);
    }
    connect = url.origin;
  }
  return [
    "default-src 'self'",
    `connect-src ${connect}`,
    "img-src 'self' data:",
    'font-src https://fonts.gstatic.com',
    "style-src 'self' https://fonts.googleapis.com",
  ].join('; ');
}

export function cspPlugin(apiOrigin: string | undefined): Plugin {
  const policy = buildCsp(apiOrigin);
  return {
    name: 'mergescape-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
        // Right after the charset declaration, before anything that loads a resource.
        return /<meta charset[^>]*>/i.test(html)
          ? html.replace(/(<meta charset[^>]*>)/i, `$1\n    ${meta}`)
          : html.replace('<head>', `<head>\n    ${meta}`);
      },
    },
  };
}

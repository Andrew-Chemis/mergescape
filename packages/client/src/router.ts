/** Routes the client knows about. Real screens replace the placeholder in task 9. */
export type Route = { name: 'home' } | { name: 'not-found'; path: string };

/** Normalises a location hash such as `#/log/?page=2` to a path such as `/log`. */
export function normalizePath(hash: string): string {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathOnly = ''] = withoutHash.split('?');
  const trimmed = pathOnly.replace(/\/+$/, '');
  if (trimmed === '') return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Maps a location hash to a route. Unknown paths resolve to `not-found`. */
export function parseHash(hash: string): Route {
  const path = normalizePath(hash);
  switch (path) {
    case '/':
      return { name: 'home' };
    default:
      return { name: 'not-found', path };
  }
}

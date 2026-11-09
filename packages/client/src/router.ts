/** Routes the client knows about. Later tasks add Shop, Run Map, Bestiary and the rest. */
export type Route =
  | { name: 'home' }
  | { name: 'log' }
  | { name: 'character' }
  | { name: 'welcome' }
  | { name: 'not-found'; path: string };

export type RouteName = Route['name'];

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
    case '/log':
      return { name: 'log' };
    case '/character':
      return { name: 'character' };
    case '/welcome':
      return { name: 'welcome' };
    default:
      return { name: 'not-found', path };
  }
}

/** The screen title, for the page title and the frame bar. */
export const ROUTE_TITLES: Readonly<Record<Exclude<RouteName, 'not-found'>, string>> = {
  home: 'Town',
  log: 'Combat Log',
  character: 'Character',
  welcome: 'Welcome',
};

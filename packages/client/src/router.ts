/** Routes the client knows about. Later tasks add Expedition, Forge and Feats. */
export type Route =
  | { name: 'home' }
  | { name: 'log' }
  | { name: 'character' }
  | { name: 'shop' }
  | { name: 'map' }
  | { name: 'bestiary' }
  | { name: 'settings' }
  | { name: 'privacy' }
  | { name: 'terms' }
  | { name: 'cookies' }
  | { name: 'welcome' }
  | { name: 'not-found'; path: string };

export type RouteName = Route['name'];

/** The routes that are plain text and open without signing in (Landing links to them). */
export const PUBLIC_ROUTES: readonly RouteName[] = ['privacy', 'terms', 'cookies'];

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
    case '/shop':
      return { name: 'shop' };
    case '/map':
      return { name: 'map' };
    case '/bestiary':
      return { name: 'bestiary' };
    case '/settings':
      return { name: 'settings' };
    case '/privacy':
      return { name: 'privacy' };
    case '/terms':
      return { name: 'terms' };
    case '/cookies':
      return { name: 'cookies' };
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
  shop: 'Shop',
  map: 'Run Map',
  bestiary: 'Bestiary',
  settings: 'Settings',
  privacy: 'Privacy',
  terms: 'Terms',
  cookies: 'Cookies',
  welcome: 'Welcome',
};

import { mount } from 'svelte';
import './lib/theme.css';
import App from './App.svelte';
import { apiOrigin, clearToken, consumeTokenFromHash, signInUrl } from './lib/api';
import { resolveBoot } from './lib/boot';
import { Session } from './lib/session.svelte';
import { armSound } from './lib/sound';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Mount point #app not found');
}

// Coming back from GitHub sign-in the api puts the session token in the URL fragment; store it and
// clear the fragment before the router reads it.
consumeTokenFromHash();

// Sound is opt-in and needs a gesture: listen for the first touch of the page. Nothing audio is created
// here, and nothing at all while the player has not turned sound on in Settings.
armSound();

const origin = apiOrigin();
const boot = resolveBoot(window.location.search, origin);
const session = new Session(boot.api, {
  pollMs: boot.pollMs,
  onUnauthorized: clearToken,
});

mount(App, {
  target,
  props: {
    session,
    signInHref: signInUrl(origin),
    ...(boot.mode === 'live'
      ? {
          onSignOut: () => {
            clearToken();
            window.location.reload();
          },
        }
      : {}),
  },
});

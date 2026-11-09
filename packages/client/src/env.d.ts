/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the api service (the SAM stack's `ApiUrl`). Unset: the client runs on fixtures. */
  readonly VITE_API_ORIGIN?: string;
  /** Slug of the GitHub App, for the install link. Default `mergescape`. */
  readonly VITE_GITHUB_APP_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

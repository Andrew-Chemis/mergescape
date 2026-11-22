import { SHARED_PACKAGE } from '@mergescape/shared';

/** Package entry. The Lambda entry points are `handlers/ingest.ts` and `handlers/api.ts`. */
export const BACKEND_PACKAGE = '@mergescape/backend';

/** Proves the workspace link to the shared package resolves. */
export const SHARED_DEPENDENCY = SHARED_PACKAGE;

export type * from './api-types';

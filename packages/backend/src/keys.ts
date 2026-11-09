/** Primary-key builders for every item type in design.md section 9.1 (single-table design). */

export interface Key {
  PK: string;
  SK: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A GitHub login: letters, digits and hyphens, at most 39 characters, not starting with a hyphen. */
export const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Numeric GitHub ids and counters: non-negative safe integers only, so a key can never be injected. */
export function assertId(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer`);
  }
  return value;
}

/** Delivery GUIDs, OAuth nonces and week keys: a short URL-safe token. */
export function assertToken(value: string, what: string): string {
  if (!SAFE_ID.test(value)) {
    throw new RangeError(`${what} is not a valid token`);
  }
  return value;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** An ISO-8601 UTC instant as GitHub and `Date#toISOString` write it. */
export function assertInstant(value: string, what: string): string {
  if (!ISO_INSTANT.test(value)) {
    throw new RangeError(`${what} is not an ISO-8601 UTC instant`);
  }
  return value;
}

/** Partition-key prefix of every item a player owns. */
export const USER_PK_PREFIX = 'USER#';

export const userPk = (userId: number): string => `${USER_PK_PREFIX}${assertId(userId, 'user id')}`;

const USER_PK = /^USER#(\d+)$/;

/** The id in a `USER#<id>` partition key; null for any other key (or an id that is not a safe integer). */
export function userIdFromPk(pk: string): number | null {
  const digits = USER_PK.exec(pk)?.[1];
  const id = Number(digits);
  return digits !== undefined && Number.isSafeInteger(id) ? id : null;
}

/** GSI1 partition of a login (matched case-insensitively): the badge finds a player by it. */
export const loginPk = (login: string): string => `LOGIN#${login.toLowerCase()}`;

export const prPk = (repoId: number, number: number): string =>
  `PR#${assertId(repoId, 'repo id')}#${assertId(number, 'PR number')}`;

export const profileKey = (userId: number): Key => ({ PK: userPk(userId), SK: 'PROFILE' });

export const eventKey = (userId: number, ts: string, deliveryId: string): Key => ({
  PK: userPk(userId),
  SK: `EVT#${assertInstant(ts, 'event timestamp')}#${assertToken(deliveryId, 'delivery id')}`,
});

export const weekKeyOf = (userId: number, weekKey: string): Key => ({
  PK: userPk(userId),
  SK: `WEEK#${assertToken(weekKey, 'week key')}`,
});

/** One expedition, keyed by the instant it was sent (design.md 9.1). */
export const expeditionKey = (userId: number, sentAt: string): Key => ({
  PK: userPk(userId),
  SK: `EXPEDITION#${assertInstant(sentAt, 'expedition time')}`,
});

/** The current (or last) order at a station. */
export const jobKey = (userId: number, station: string): Key => ({
  PK: userPk(userId),
  SK: `JOB#${assertToken(station, 'station')}`,
});

/** A Feat, written once when it unlocks. */
export const featKey = (userId: number, featId: string): Key => ({
  PK: userPk(userId),
  SK: `FEAT#${assertToken(featId, 'feat id')}`,
});

export const prMetaKey = (repoId: number, number: number): Key => ({
  PK: prPk(repoId, number),
  SK: 'META',
});

export const reviewKey = (
  repoId: number,
  number: number,
  submittedAt: string,
  reviewerId: number,
  deliveryId: string,
): Key => ({
  PK: prPk(repoId, number),
  SK: `REVIEW#${assertInstant(submittedAt, 'review time')}#${assertId(reviewerId, 'reviewer id')}#${assertToken(deliveryId, 'delivery id')}`,
});

export const inlineKey = (
  repoId: number,
  number: number,
  reviewerId: number,
  deliveryId: string,
): Key => ({
  PK: prPk(repoId, number),
  SK: `INLINE#${assertId(reviewerId, 'reviewer id')}#${assertToken(deliveryId, 'delivery id')}`,
});

export const installKey = (installationId: number): Key => ({
  PK: `INSTALL#${assertId(installationId, 'installation id')}`,
  SK: 'META',
});

export const deliveryKey = (deliveryId: string): Key => ({
  PK: `DELIVERY#${assertToken(deliveryId, 'delivery id')}`,
  SK: 'META',
});

export const stateKey = (nonce: string): Key => ({
  PK: `STATE#${assertToken(nonce, 'state nonce')}`,
  SK: 'META',
});

export const EVENT_SK_PREFIX = 'EVT#';
export const REVIEW_SK_PREFIX = 'REVIEW#';
export const INLINE_SK_PREFIX = 'INLINE#';

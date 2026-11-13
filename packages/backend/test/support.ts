import { expect } from 'vitest';
import { Db } from '../src/db';
import type { DocClient } from '../src/db';
import { assertItemAllowed, classifyItem } from '../src/schema';
import { FakeDynamo } from './fake-dynamo';
import type { FakeDynamoOptions } from './fake-dynamo';

export const TABLE_NAME = 'mergescape';

/** A repository over a fresh in-memory table. */
export function makeDb(options: FakeDynamoOptions = {}): { fake: FakeDynamo; db: Db } {
  const fake = new FakeDynamo({ tableName: TABLE_NAME, ...options });
  return { fake, db: new Db(fake as unknown as DocClient, TABLE_NAME) };
}

/**
 * The Requirement 3.5 audit: every item in the table must be a recognised item type and carry only
 * attributes on that type's allow-list. Run it after any end-to-end scenario.
 */
export function auditSchema(fake: FakeDynamo): void {
  for (const item of fake.snapshot()) {
    const pk = String(item.PK);
    const sk = String(item.SK);
    const kind = classifyItem(pk, sk);
    expect(kind, `unrecognised item ${pk} / ${sk}`).not.toBeNull();
    if (kind) {
      assertItemAllowed(kind, item);
    }
  }
}

/** Items whose partition key starts with `prefix`, in key order. */
export function itemsWithPrefix(fake: FakeDynamo, prefix: string) {
  return fake
    .snapshot()
    .filter((item) => String(item.PK).startsWith(prefix))
    .sort((a, b) =>
      `${String(a.PK)}|${String(a.SK)}`.localeCompare(`${String(b.PK)}|${String(b.SK)}`),
    );
}

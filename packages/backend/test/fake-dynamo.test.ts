import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { FakeDynamo } from './fake-dynamo';

const TABLE = 'mergescape';

function setup() {
  return new FakeDynamo({ tableName: TABLE });
}

async function put(fake: FakeDynamo, item: Record<string, unknown>, extra: object = {}) {
  return fake.send(new PutCommand({ TableName: TABLE, Item: item, ...extra }));
}

async function expectError(promise: Promise<unknown>, name: string) {
  await expect(promise).rejects.toMatchObject({ name });
}

describe('FakeDynamo put/get/delete', () => {
  it('stores copies, not references', async () => {
    const fake = setup();
    const item = { PK: 'A', SK: 'B', nested: { n: 1 }, tags: new Set([1, 2]) };
    await put(fake, item);
    item.nested.n = 99;
    const read = await fake.send(new GetCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'B' } }));
    expect(read).toEqual({ Item: { PK: 'A', SK: 'B', nested: { n: 1 }, tags: new Set([1, 2]) } });
    expect(
      await fake.send(new GetCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'X' } })),
    ).toEqual({});
  });

  it('enforces attribute_not_exists and ConditionalCheckFailedException', async () => {
    const fake = setup();
    const condition = {
      ConditionExpression: 'attribute_not_exists(PK)',
    };
    await put(fake, { PK: 'D', SK: 'META' }, condition);
    await expectError(
      put(fake, { PK: 'D', SK: 'META' }, condition),
      'ConditionalCheckFailedException',
    );
  });

  it('supports OR conditions with aliased names and values', async () => {
    const fake = setup();
    await put(fake, { PK: 'D', SK: 'META', released: true });
    await put(
      fake,
      { PK: 'D', SK: 'META' },
      {
        ConditionExpression: 'attribute_not_exists(#a) OR #b = :t',
        ExpressionAttributeNames: { '#a': 'PK', '#b': 'released' },
        ExpressionAttributeValues: { ':t': true },
      },
    );
    await expectError(
      put(
        fake,
        { PK: 'D', SK: 'META' },
        {
          ConditionExpression: 'attribute_not_exists(#a) OR #b = :t',
          ExpressionAttributeNames: { '#a': 'PK', '#b': 'released' },
          ExpressionAttributeValues: { ':t': true },
        },
      ),
      'ConditionalCheckFailedException',
    );
  });

  it('deletes with a numeric comparison condition and returns the old item', async () => {
    const fake = setup();
    await put(fake, { PK: 'S', SK: 'META', ttl: 100 });
    const condition = {
      ConditionExpression: 'attribute_exists(#pk) AND #ttl > :now',
      ExpressionAttributeNames: { '#pk': 'PK', '#ttl': 'ttl' },
    };
    await expectError(
      fake.send(
        new DeleteCommand({
          TableName: TABLE,
          Key: { PK: 'S', SK: 'META' },
          ...condition,
          ExpressionAttributeValues: { ':now': 100 },
        }),
      ),
      'ConditionalCheckFailedException',
    );
    expect(fake.size).toBe(1);
    const deleted = await fake.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { PK: 'S', SK: 'META' },
        ReturnValues: 'ALL_OLD',
        ...condition,
        ExpressionAttributeValues: { ':now': 99 },
      }),
    );
    expect(deleted).toEqual({ Attributes: { PK: 'S', SK: 'META', ttl: 100 } });
    expect(fake.size).toBe(0);
  });

  it('rejects undefined values, NaN, empty sets and missing keys like the marshaller would', async () => {
    const fake = setup();
    await expectError(put(fake, { PK: 'A', SK: 'B', x: undefined }), 'ValidationException');
    await expectError(put(fake, { PK: 'A', SK: 'B', x: Number.NaN }), 'ValidationException');
    await expectError(put(fake, { PK: 'A', SK: 'B', x: new Set() }), 'ValidationException');
    await expectError(put(fake, { PK: 'A', x: 1 }), 'ValidationException');
    await expectError(
      fake.send(new PutCommand({ TableName: 'other', Item: { PK: 'A', SK: 'B' } })),
      'ResourceNotFoundException',
    );
  });
});

describe('FakeDynamo update expressions', () => {
  const key = { PK: 'U', SK: 'P' };
  const update = (fake: FakeDynamo, input: object) =>
    fake.send(new UpdateCommand({ TableName: TABLE, Key: key, ReturnValues: 'ALL_NEW', ...input }));

  it('upserts, ADDs numbers atomically, SETs if_not_exists and REMOVEs', async () => {
    const fake = setup();
    const first = await update(fake, {
      UpdateExpression: 'SET #c = if_not_exists(#c, :zero), #l = :l ADD #x :n',
      ExpressionAttributeNames: { '#c': 'created', '#l': 'login', '#x': 'xp' },
      ExpressionAttributeValues: { ':zero': 5, ':l': 'octo', ':n': 10 },
    });
    expect(first).toEqual({ Attributes: { PK: 'U', SK: 'P', created: 5, login: 'octo', xp: 10 } });
    const second = await update(fake, {
      UpdateExpression: 'SET #c = if_not_exists(#c, :zero) ADD #x :n REMOVE #l',
      ExpressionAttributeNames: { '#c': 'created', '#l': 'login', '#x': 'xp' },
      ExpressionAttributeValues: { ':zero': 7, ':n': 5 },
    });
    expect(second).toEqual({ Attributes: { PK: 'U', SK: 'P', created: 5, xp: 15 } });
  });

  it('supports arithmetic in SET, evaluated against the pre-update item', async () => {
    const fake = setup();
    await put(fake, { ...key, a: 1, b: 10 });
    const result = await update(fake, {
      UpdateExpression: 'SET #a = #a + :one, #b = #a + :ten',
      ExpressionAttributeNames: { '#a': 'a', '#b': 'b' },
      ExpressionAttributeValues: { ':one': 1, ':ten': 10 },
    });
    expect(result).toEqual({ Attributes: { ...key, a: 2, b: 11 } });
  });

  it('ADDs and DELETEs set elements, dropping the attribute when the set empties', async () => {
    const fake = setup();
    await update(fake, {
      UpdateExpression: 'ADD #r :s',
      ExpressionAttributeNames: { '#r': 'repo_ids' },
      ExpressionAttributeValues: { ':s': new Set([1, 2]) },
    });
    await update(fake, {
      UpdateExpression: 'ADD #r :s',
      ExpressionAttributeNames: { '#r': 'repo_ids' },
      ExpressionAttributeValues: { ':s': new Set([2, 3]) },
    });
    expect(fake.peek('U', 'P')?.repo_ids).toEqual(new Set([1, 2, 3]));
    await update(fake, {
      UpdateExpression: 'DELETE #r :s',
      ExpressionAttributeNames: { '#r': 'repo_ids' },
      ExpressionAttributeValues: { ':s': new Set([1, 2, 3]) },
    });
    expect(fake.peek('U', 'P')).toEqual(key);
  });

  it('reads and writes nested document paths', async () => {
    const fake = setup();
    await put(fake, { ...key, skill: { smithing: 1 } });
    await update(fake, {
      UpdateExpression: 'ADD #s.#k :n',
      ExpressionAttributeNames: { '#s': 'skill', '#k': 'smithing' },
      ExpressionAttributeValues: { ':n': 4 },
    });
    expect(fake.peek('U', 'P')?.skill).toEqual({ smithing: 5 });
  });

  it('fails the condition without writing, and on a missing item attribute_exists is false', async () => {
    const fake = setup();
    await expectError(
      update(fake, {
        UpdateExpression: 'ADD #x :n',
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: { '#x': 'xp', '#pk': 'PK' },
        ExpressionAttributeValues: { ':n': 1 },
      }),
      'ConditionalCheckFailedException',
    );
    expect(fake.size).toBe(0);
    await put(fake, { ...key, version: 3 });
    await expectError(
      update(fake, {
        UpdateExpression: 'ADD #x :n',
        ConditionExpression: '#v = :v',
        ExpressionAttributeNames: { '#x': 'xp', '#v': 'version' },
        ExpressionAttributeValues: { ':n': 1, ':v': 2 },
      }),
      'ConditionalCheckFailedException',
    );
  });

  it('rejects overlapping paths, unused or undefined placeholders and unaliased reserved words', async () => {
    const fake = setup();
    await expectError(
      update(fake, {
        UpdateExpression: 'ADD #r :a DELETE #r :b',
        ExpressionAttributeNames: { '#r': 'repo_ids' },
        ExpressionAttributeValues: { ':a': new Set([1]), ':b': new Set([2]) },
      }),
      'ValidationException',
    );
    await expectError(
      update(fake, {
        UpdateExpression: 'SET #a = :a',
        ExpressionAttributeNames: { '#a': 'a', '#unused': 'b' },
        ExpressionAttributeValues: { ':a': 1 },
      }),
      'ValidationException',
    );
    await expectError(
      update(fake, {
        UpdateExpression: 'SET #a = :missing',
        ExpressionAttributeNames: { '#a': 'a' },
        ExpressionAttributeValues: { ':a': 1 },
      }),
      'ValidationException',
    );
    await expectError(
      update(fake, { UpdateExpression: 'SET level = :a', ExpressionAttributeValues: { ':a': 1 } }),
      'ValidationException',
    );
  });

  it('refuses to update key attributes', async () => {
    const fake = setup();
    await expectError(
      update(fake, {
        UpdateExpression: 'SET #p = :v',
        ExpressionAttributeNames: { '#p': 'PK' },
        ExpressionAttributeValues: { ':v': 'x' },
      }),
      'ValidationException',
    );
  });
});

describe('FakeDynamo query', () => {
  async function seed(fake: FakeDynamo) {
    for (const sk of ['EVT#1', 'EVT#2', 'EVT#3', 'WEEK#1', 'PROFILE']) {
      await put(fake, { PK: 'USER#1', SK: sk });
    }
    await put(fake, { PK: 'USER#2', SK: 'EVT#9' });
  }

  it('filters by partition and begins_with, newest first with Limit and ExclusiveStartKey', async () => {
    const fake = setup();
    await seed(fake);
    const base = {
      TableName: TABLE,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :p)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: { ':pk': 'USER#1', ':p': 'EVT#' },
      ScanIndexForward: false,
    };
    const page1 = await fake.send(new QueryCommand({ ...base, Limit: 2 }));
    expect((page1.Items ?? []).map((item) => item.SK)).toEqual(['EVT#3', 'EVT#2']);
    expect(page1.LastEvaluatedKey).toEqual({ PK: 'USER#1', SK: 'EVT#2' });
    const page2 = await fake.send(
      new QueryCommand({ ...base, Limit: 2, ExclusiveStartKey: page1.LastEvaluatedKey }),
    );
    expect((page2.Items ?? []).map((item) => item.SK)).toEqual(['EVT#1']);
    expect(page2.LastEvaluatedKey).toBeUndefined();
  });

  it('returns a whole partition in sort-key order for a plain partition query', async () => {
    const fake = setup();
    await seed(fake);
    const result = await fake.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': 'PK' },
        ExpressionAttributeValues: { ':pk': 'USER#1' },
      }),
    );
    expect((result.Items ?? []).map((item) => item.SK)).toEqual([
      'EVT#1',
      'EVT#2',
      'EVT#3',
      'PROFILE',
      'WEEK#1',
    ]);
  });

  it('queries the sparse GSI1 by login', async () => {
    const fake = setup();
    await put(fake, { PK: 'USER#1', SK: 'PROFILE', GSI1PK: 'LOGIN#octo', GSI1SK: 'USER#1' });
    await put(fake, { PK: 'USER#2', SK: 'PROFILE' });
    const result = await fake.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: '#g = :g',
        ExpressionAttributeNames: { '#g': 'GSI1PK' },
        ExpressionAttributeValues: { ':g': 'LOGIN#octo' },
      }),
    );
    expect(result.Items).toHaveLength(1);
  });

  it('rejects a query that is not an equality on the partition key', async () => {
    const fake = setup();
    await expectError(
      fake.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'begins_with(#sk, :p)',
          ExpressionAttributeNames: { '#sk': 'SK' },
          ExpressionAttributeValues: { ':p': 'EVT#' },
        }),
      ),
      'ValidationException',
    );
  });
});

describe('FakeDynamo batch write, TTL sweep, access control and call log', () => {
  it('applies put and delete requests atomically and rejects duplicates and oversize batches', async () => {
    const fake = setup();
    await put(fake, { PK: 'A', SK: 'old' });
    await fake.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE]: [
            { PutRequest: { Item: { PK: 'A', SK: 'new' } } },
            { DeleteRequest: { Key: { PK: 'A', SK: 'old' } } },
          ],
        },
      }),
    );
    expect(fake.snapshot().map((item) => item.SK)).toEqual(['new']);
    await expectError(
      fake.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: [
              { PutRequest: { Item: { PK: 'A', SK: 'dup' } } },
              { PutRequest: { Item: { PK: 'A', SK: 'dup' } } },
            ],
          },
        }),
      ),
      'ValidationException',
    );
    const tooMany = Array.from({ length: 26 }, (_, index) => ({
      PutRequest: { Item: { PK: 'B', SK: String(index) } },
    }));
    await expectError(
      fake.send(new BatchWriteCommand({ RequestItems: { [TABLE]: tooMany } })),
      'ValidationException',
    );
  });

  it('expires only items whose ttl has passed, and only when asked', async () => {
    const fake = setup();
    await put(fake, { PK: 'A', SK: 'old', ttl: 10 });
    await put(fake, { PK: 'A', SK: 'new', ttl: 20 });
    await put(fake, { PK: 'A', SK: 'none' });
    expect(fake.size).toBe(3);
    expect(fake.expireTtl(10)).toBe(1);
    expect(
      fake
        .snapshot()
        .map((item) => item.SK)
        .sort(),
    ).toEqual(['new', 'none']);
  });

  it('denies operations outside the allow-list and counts write calls', async () => {
    const fake = new FakeDynamo({ tableName: TABLE, allowedOperations: ['PutItem', 'GetItem'] });
    await put(fake, { PK: 'A', SK: 'B' });
    await expectError(
      fake.send(new DeleteCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'B' } })),
      'AccessDeniedException',
    );
    await fake.send(new GetCommand({ TableName: TABLE, Key: { PK: 'A', SK: 'B' } }));
    expect(fake.writeCalls).toBe(2);
    expect(fake.calls.map((call) => call.operation)).toEqual(['PutItem', 'DeleteItem', 'GetItem']);
  });
});

describe('FakeDynamo Scan and the GSI projection', () => {
  const profile = (id: number, extra: Record<string, unknown> = {}) => ({
    PK: 'USER#' + String(id),
    SK: 'PROFILE',
    GSI1PK: 'LOGIN#player-' + String(id),
    GSI1SK: 'USER#' + String(id),
    login: 'Player-' + String(id),
    level: 7,
    xp: 12345,
    renown: 2,
    vocation: 'Smith',
    gold: 999,
    charms: [{ id: 'rubber-duck' }],
    ...extra,
  });

  async function seeded() {
    const fake = setup();
    for (const id of [3, 1, 2]) {
      await put(fake, profile(id));
    }
    await put(fake, { PK: 'USER#1', SK: 'WEEK#2026-46', weekly_xp: 5 });
    return fake;
  }

  const scan = (fake: FakeDynamo, input: object = {}) =>
    fake.send(new ScanCommand({ TableName: TABLE, IndexName: 'GSI1', ...input }));

  it('scans only the sparse GSI1: profiles, in index order, never the other items', async () => {
    const fake = await seeded();
    const result = await scan(fake);
    expect(result.Items?.map((item) => item.PK)).toEqual(['USER#1', 'USER#2', 'USER#3']);
    expect(result.LastEvaluatedKey).toBeUndefined();
  });

  it('projects the keys and the INCLUDE attributes, not the whole item (template.yaml)', async () => {
    const fake = await seeded();
    const [item] = (await scan(fake)).Items ?? [];
    expect(item).toEqual({
      PK: 'USER#1',
      SK: 'PROFILE',
      GSI1PK: 'LOGIN#player-1',
      GSI1SK: 'USER#1',
      login: 'Player-1',
      level: 7,
      xp: 12345,
      renown: 2,
      vocation: 'Smith',
    });
    // A query through the index is projected the same way.
    const queried = await fake.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: '#g = :g',
        ExpressionAttributeNames: { '#g': 'GSI1PK' },
        ExpressionAttributeValues: { ':g': 'LOGIN#player-2' },
      }),
    );
    expect(queried.Items?.[0]).not.toHaveProperty('gold');
    expect(queried.Items?.[0]).toHaveProperty('vocation', 'Smith');
    // The table read still has everything.
    expect(fake.peek('USER#1', 'PROFILE')).toHaveProperty('gold', 999);
  });

  it('pages with Limit and LastEvaluatedKey until the index is exhausted', async () => {
    const fake = await seeded();
    const first = await scan(fake, { Limit: 2 });
    expect(first.Items).toHaveLength(2);
    expect(first.LastEvaluatedKey).toMatchObject({ PK: 'USER#2', SK: 'PROFILE' });
    const second = await scan(fake, { Limit: 2, ExclusiveStartKey: first.LastEvaluatedKey });
    expect(second.Items?.map((item) => item.PK)).toEqual(['USER#3']);
    expect(second.LastEvaluatedKey).toBeUndefined();
  });

  it('refuses a Scan of the table itself, whatever the role may call', async () => {
    const fake = await seeded();
    await expectError(fake.send(new ScanCommand({ TableName: TABLE })), 'AccessDeniedException');
  });

  it('refuses a Scan to a role without it, and tags each call with its role', async () => {
    const fake = await seeded();
    const ingest = fake.forRole('ingest', ['PutItem', 'GetItem', 'UpdateItem', 'Query']);
    const api = fake.forRole('api', ['Scan']);
    await expectError(
      ingest.send(new ScanCommand({ TableName: TABLE, IndexName: 'GSI1' })),
      'AccessDeniedException',
    );
    expect(
      (await api.send(new ScanCommand({ TableName: TABLE, IndexName: 'GSI1' }))).Items,
    ).toHaveLength(3);
    expect(
      fake.calls.filter((call) => call.role).map((call) => [call.role, call.operation]),
    ).toEqual([
      ['ingest', 'Scan'],
      ['api', 'Scan'],
    ]);
    // A role view shares the store with every other.
    await expectError(
      api.send(new PutCommand({ TableName: TABLE, Item: { PK: 'X', SK: 'Y' } })),
      'AccessDeniedException',
    );
  });

  it('rejects filters, projections and segments it does not emulate', async () => {
    const fake = await seeded();
    await expectError(scan(fake, { FilterExpression: 'level > :l' }), 'ValidationException');
    await expectError(scan(fake, { ProjectionExpression: 'PK' }), 'ValidationException');
    await expectError(scan(fake, { Limit: 0 }), 'ValidationException');
  });
});

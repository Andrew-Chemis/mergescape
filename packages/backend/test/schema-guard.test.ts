/**
 * Schema-guard coverage (task 19, Requirements 3.1 to 3.5): every write path of the backend goes through
 * `Db#put` or `Db#update`, and every item type those two are called with has an allow-list.
 *
 * The scan reads the production sources, so a new write call site, or a new item type, that skips the
 * guard fails here instead of shipping. (When task 22 adds `FEAT#`, `EXPEDITION#` and `JOB#` items, this
 * test will not pass until `schema.ts` has an allow-list for each.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Db } from '../src/db';
import type { DocClient } from '../src/db';
import { ALLOWED_ATTRIBUTES, classifyItem, SchemaViolationError } from '../src/schema';
import type { ItemKind } from '../src/schema';
import { FakeDynamo } from './fake-dynamo';
import { TABLE_NAME } from './support';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

interface Source {
  file: string;
  text: string;
}

/** Every production TypeScript file under src/, relative to it. */
function sources(directory = SRC, prefix = ''): Source[] {
  const found: Source[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...sources(`${directory}${entry.name}/`, `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push({
        file: `${prefix}${entry.name}`,
        text: readFileSync(`${directory}${entry.name}`, 'utf8'),
      });
    }
  }
  return found;
}

interface CallSite {
  file: string;
  method: 'put' | 'update';
  /** The first argument as written: `'PROFILE'` with quotes, or an identifier. */
  kind: string;
}

/** A call on something that is a `Db`: `this.put(`, `db.update(`, `x.db.put(`, `ingestDb.put(`. */
const DB_WRITE = /(?:\bthis|\bdb|\.db|\w*Db)\.(put|update)\(\s*([^\s,)]+)/g;

function callSites(): CallSite[] {
  return sources().flatMap(({ file, text }) =>
    [...text.matchAll(DB_WRITE)].map((match) => ({
      file,
      method: match[1] as CallSite['method'],
      kind: match[2] ?? '',
    })),
  );
}

const KINDS = Object.keys(ALLOWED_ATTRIBUTES) as ItemKind[];

describe('every write goes through the schema guard', () => {
  it('finds the write call sites (the scan itself works)', () => {
    const sites = callSites();
    expect(sites.length).toBeGreaterThanOrEqual(18);
    expect(sites.some((site) => site.method === 'put')).toBe(true);
    expect(sites.some((site) => site.method === 'update')).toBe(true);
    expect(new Set(sites.map((site) => site.file))).toEqual(new Set(['db.ts']));
  });

  it('passes a string-literal item type at every call site, and each one has an allow-list', () => {
    for (const site of callSites()) {
      const literal = /^'([A-Z]+)'$/.exec(site.kind);
      expect(
        literal,
        `${site.file}: ${site.method}(${site.kind}) must name its item type`,
      ).not.toBeNull();
      const kind = literal?.[1] ?? '';
      expect(KINDS, `${site.method}('${kind}') has no allow-list in schema.ts`).toContain(kind);
      expect(ALLOWED_ATTRIBUTES[kind as ItemKind].length).toBeGreaterThan(0);
    }
  });

  it('has an allow-list only for item types something writes, and recognises each one by its keys', () => {
    const written = new Set(
      callSites().map((site) => /^'([A-Z]+)'$/.exec(site.kind)?.[1] ?? site.kind),
    );
    expect([...written].sort()).toEqual([...KINDS].sort());
    const samples: Record<ItemKind, [string, string]> = {
      PROFILE: ['USER#1', 'PROFILE'],
      EVENT: ['USER#1', 'EVT#2026-11-09T12:00:00.000Z#d'],
      WEEK: ['USER#1', 'WEEK#2026-46'],
      PR: ['PR#1#2', 'META'],
      REVIEW: ['PR#1#2', 'REVIEW#2026-11-09T12:00:00Z#3#d'],
      INSTALL: ['INSTALL#1', 'META'],
      DELIVERY: ['DELIVERY#d', 'META'],
      STATE: ['STATE#n', 'META'],
    };
    expect(Object.keys(samples).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
      expect(classifyItem(...samples[kind])).toBe(kind);
    }
  });

  it('keeps the guard in the repository: only db.ts builds write commands or sends to the table', () => {
    for (const { file, text } of sources()) {
      const importsCommands =
        /\b(?:PutCommand|UpdateCommand|DeleteCommand|BatchWriteCommand|TransactWriteCommand)\b/.test(
          text,
        );
      const sendsToTable = /\bclient\.send\(/.test(text);
      expect(importsCommands, `${file} must not build write commands`).toBe(file === 'db.ts');
      expect(sendsToTable, `${file} must not call DocumentClient#send`).toBe(file === 'db.ts');
    }
    const db = sources().find(({ file }) => file === 'db.ts')?.text ?? '';
    // PutItem and UpdateItem are built once each, inside the two guarded methods, after the guard has run.
    const put = db.slice(db.indexOf('async put('), db.indexOf('async update('));
    const update = db.slice(db.indexOf('async update('), db.indexOf('private async getItem('));
    expect(db.match(/new PutCommand\(/g)).toHaveLength(1);
    expect(db.match(/new UpdateCommand\(/g)).toHaveLength(1);
    expect(put).toContain('assertItemAllowed(kind, item);');
    expect(put.indexOf('assertItemAllowed')).toBeLessThan(put.indexOf('new PutCommand('));
    expect(update).toContain('assertItemAllowed(kind,');
    expect(update).toContain('assertAttributesAllowed(kind, ops.remove');
    expect(update.indexOf('assertAttributesAllowed')).toBeLessThan(
      update.indexOf('new UpdateCommand('),
    );
  });
});

describe('the guard rejects an attribute outside the allow-list, whatever the item type', () => {
  const key = { PK: 'USER#1', SK: 'PROFILE' };

  function client() {
    const fake = new FakeDynamo({ tableName: TABLE_NAME });
    return { fake, db: new Db(fake as unknown as DocClient, TABLE_NAME) };
  }

  it.each(KINDS)('Db#put on %s throws before anything is sent', async (kind) => {
    const { fake, db } = client();
    await expect(db.put(kind, key, { unlisted_attribute: 1 })).rejects.toBeInstanceOf(
      SchemaViolationError,
    );
    await expect(
      db.put(kind, key, {
        ...Object.fromEntries(ALLOWED_ATTRIBUTES[kind].map((name) => [name, 1])),
        title: 'x',
      }),
    ).rejects.toThrow(`Attributes not allowed on ${kind} items: title`);
    expect(fake.calls).toEqual([]);
  });

  it.each(KINDS)(
    'Db#update on %s throws before anything is sent, for every kind of operation',
    async (kind) => {
      const { fake, db } = client();
      for (const ops of [
        { set: { unlisted_attribute: 1 } },
        { setIfAbsent: { unlisted_attribute: 1 } },
        { add: { unlisted_attribute: 1 } },
        { deleteFrom: { unlisted_attribute: new Set([1]) } },
        { remove: ['unlisted_attribute'] },
      ]) {
        await expect(db.update(kind, key, ops)).rejects.toBeInstanceOf(SchemaViolationError);
      }
      expect(fake.calls).toEqual([]);
    },
  );

  it('refuses, on the PR and Combat Log items, the attributes Requirement 3.3 forbids', async () => {
    const { fake, db } = client();
    for (const name of [
      'title',
      'body',
      'comment',
      'comment_body',
      'path',
      'filename',
      'diff',
      'repo_name',
      'branch',
      'head_ref',
    ]) {
      for (const kind of ['PR', 'REVIEW', 'EVENT'] as const) {
        expect(ALLOWED_ATTRIBUTES[kind]).not.toContain(name);
        await expect(db.put(kind, key, { [name]: 'x' })).rejects.toBeInstanceOf(
          SchemaViolationError,
        );
      }
    }
    expect(fake.calls).toEqual([]);
  });

  it('accepts exactly the listed attributes (the guard is not simply rejecting everything)', async () => {
    const { fake, db } = client();
    for (const kind of KINDS) {
      await db.put(
        kind,
        { PK: `${kind}#1`, SK: kind === 'PROFILE' ? 'PROFILE' : 'META' },
        Object.fromEntries(ALLOWED_ATTRIBUTES[kind].map((name) => [name, 1])),
      );
    }
    expect(fake.size).toBe(KINDS.length);
  });
});

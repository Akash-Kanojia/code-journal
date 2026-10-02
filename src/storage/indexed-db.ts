import { submissionKey, type CodingSubmission } from '../core/models/coding-submission';
import type {
  SaveResult,
  SecretStore,
  StoredSubmission,
  SubmissionRecord,
  SubmissionStore,
  SyncCounts,
  SyncEntry,
  SyncPatch,
} from './storage';

export const DB_NAME = 'code-journal';
const DB_VERSION = 1;

const SUBMISSIONS = 'submissions';
const SYNC_QUEUE = 'syncQueue';
const SECRETS = 'secrets';

/** Raw platform payloads above this size are not stored; they are debugging aids only. */
const MAX_RAW_BYTES = 64 * 1024;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

export function openDatabase(
  factory: IDBFactory = indexedDB,
  name = DB_NAME,
): Promise<IDBDatabase> {
  const open = factory.open(name, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(SUBMISSIONS)) {
      db.createObjectStore(SUBMISSIONS, { keyPath: 'key' }).createIndex(
        'submittedAt',
        'submission.submittedAt',
      );
    }
    if (!db.objectStoreNames.contains(SYNC_QUEUE)) {
      db.createObjectStore(SYNC_QUEUE, { keyPath: 'key' }).createIndex('status', 'status');
    }
    if (!db.objectStoreNames.contains(SECRETS)) {
      db.createObjectStore(SECRETS);
    }
  };
  return request(open);
}

function withoutOversizedRaw(submission: CodingSubmission): CodingSubmission {
  if (submission.raw === undefined) return submission;
  let size: number;
  try {
    size = JSON.stringify(submission.raw).length;
  } catch {
    size = Infinity;
  }
  if (size <= MAX_RAW_BYTES) return submission;
  const copy = { ...submission };
  delete copy.raw;
  return copy;
}

const bySubmittedAt = (a: { submittedAt: string }, b: { submittedAt: string }): number =>
  Date.parse(a.submittedAt) - Date.parse(b.submittedAt);

export class IndexedDbStore implements SubmissionStore, SecretStore {
  constructor(private readonly db: IDBDatabase) {}

  static async open(factory?: IDBFactory, name?: string): Promise<IndexedDbStore> {
    return new IndexedDbStore(await openDatabase(factory, name));
  }

  close(): void {
    this.db.close();
  }

  async save(submission: CodingSubmission, now: Date): Promise<SaveResult> {
    const key = submissionKey(submission);
    const tx = this.db.transaction([SUBMISSIONS, SYNC_QUEUE], 'readwrite');
    const done = completion(tx);
    const submissions = tx.objectStore(SUBMISSIONS);
    const queue = tx.objectStore(SYNC_QUEUE);

    const [existingRecord, existingSync] = await Promise.all([
      request(submissions.get(key) as IDBRequest<SubmissionRecord | undefined>),
      request(queue.get(key) as IDBRequest<SyncEntry | undefined>),
    ]);
    if (existingRecord !== undefined && existingSync !== undefined) {
      await done;
      return { created: false, stored: { record: existingRecord, sync: existingSync } };
    }

    const timestamp = now.toISOString();
    const record: SubmissionRecord = existingRecord ?? {
      key,
      submission: withoutOversizedRaw(submission),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const sync: SyncEntry = existingSync ?? {
      key,
      status: 'pending',
      submittedAt: record.submission.submittedAt,
      retryCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    submissions.put(record);
    queue.put(sync);
    await done;
    return { created: true, stored: { record, sync } };
  }

  async get(key: string): Promise<StoredSubmission | undefined> {
    const tx = this.db.transaction([SUBMISSIONS, SYNC_QUEUE], 'readonly');
    const [record, sync] = await Promise.all([
      request(tx.objectStore(SUBMISSIONS).get(key) as IDBRequest<SubmissionRecord | undefined>),
      request(tx.objectStore(SYNC_QUEUE).get(key) as IDBRequest<SyncEntry | undefined>),
    ]);
    return record !== undefined && sync !== undefined ? { record, sync } : undefined;
  }

  async listRecent(limit: number): Promise<StoredSubmission[]> {
    const tx = this.db.transaction([SUBMISSIONS, SYNC_QUEUE], 'readonly');
    const index = tx.objectStore(SUBMISSIONS).index('submittedAt');
    const records: SubmissionRecord[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(null, 'prev');
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c === null || records.length >= limit) {
          resolve();
          return;
        }
        records.push(c.value as SubmissionRecord);
        c.continue();
      };
      cursor.onerror = () => {
        reject(cursor.error ?? new Error('IndexedDB cursor failed'));
      };
    });
    const queue = tx.objectStore(SYNC_QUEUE);
    const syncs = await Promise.all(
      records.map((r) => request(queue.get(r.key) as IDBRequest<SyncEntry | undefined>)),
    );
    // ISO strings sort lexically only for the same format; re-sort by parsed time.
    return records
      .flatMap((record, i) => {
        const sync = syncs[i];
        return sync === undefined ? [] : [{ record, sync }];
      })
      .sort((a, b) => bySubmittedAt(b.record.submission, a.record.submission));
  }

  async listPending(): Promise<SyncEntry[]> {
    const entries = await this.byStatus('pending');
    return entries.sort(bySubmittedAt);
  }

  async counts(): Promise<SyncCounts> {
    const tx = this.db.transaction(SYNC_QUEUE, 'readonly');
    const index = tx.objectStore(SYNC_QUEUE).index('status');
    const [pending, syncing, synced, failed] = await Promise.all(
      (['pending', 'syncing', 'synced', 'failed'] as const).map((s) => request(index.count(s))),
    );
    return {
      pending: pending ?? 0,
      syncing: syncing ?? 0,
      synced: synced ?? 0,
      failed: failed ?? 0,
    };
  }

  async updateSync(key: string, patch: SyncPatch, now: Date): Promise<SyncEntry> {
    const tx = this.db.transaction(SYNC_QUEUE, 'readwrite');
    const done = completion(tx);
    const queue = tx.objectStore(SYNC_QUEUE);
    const existing = await request(queue.get(key) as IDBRequest<SyncEntry | undefined>);
    if (existing === undefined) {
      tx.abort();
      await done.catch(() => undefined);
      throw new Error(`No sync entry for ${key}`);
    }
    const merged = Object.entries({ ...existing, ...patch }).filter(([, v]) => v !== undefined);
    const updated = {
      ...Object.fromEntries(merged),
      key,
      updatedAt: now.toISOString(),
    } as SyncEntry;
    queue.put(updated);
    await done;
    return updated;
  }

  recoverInterrupted(now: Date): Promise<number> {
    return this.moveStatus('syncing', now, (entry) => ({ ...entry, status: 'pending' }));
  }

  retryFailed(now: Date): Promise<number> {
    return this.moveStatus('failed', now, (entry) => {
      const next: SyncEntry = { ...entry, status: 'pending', retryCount: 0 };
      delete next.nextRetryAt;
      return next;
    });
  }

  clearBackoff(now: Date): Promise<number> {
    return this.moveStatus('pending', now, (entry) => {
      const next = { ...entry };
      delete next.nextRetryAt;
      return next;
    });
  }

  async getSecret<T>(name: string): Promise<T | undefined> {
    const tx = this.db.transaction(SECRETS, 'readonly');
    return (await request(tx.objectStore(SECRETS).get(name))) as T | undefined;
  }

  async setSecret(name: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(SECRETS, 'readwrite');
    tx.objectStore(SECRETS).put(value, name);
    await completion(tx);
  }

  async deleteSecret(name: string): Promise<void> {
    const tx = this.db.transaction(SECRETS, 'readwrite');
    tx.objectStore(SECRETS).delete(name);
    await completion(tx);
  }

  private async byStatus(status: SyncEntry['status']): Promise<SyncEntry[]> {
    const tx = this.db.transaction(SYNC_QUEUE, 'readonly');
    return (await request(
      tx.objectStore(SYNC_QUEUE).index('status').getAll(status),
    )) as SyncEntry[];
  }

  private async moveStatus(
    from: SyncEntry['status'],
    now: Date,
    change: (entry: SyncEntry) => SyncEntry,
  ): Promise<number> {
    const tx = this.db.transaction(SYNC_QUEUE, 'readwrite');
    const done = completion(tx);
    const queue = tx.objectStore(SYNC_QUEUE);
    const entries = (await request(queue.index('status').getAll(from))) as SyncEntry[];
    for (const entry of entries) {
      queue.put({ ...change(entry), updatedAt: now.toISOString() });
    }
    await done;
    return entries.length;
  }
}

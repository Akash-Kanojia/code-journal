import type { Platform } from './platform';

export type ImportState = 'running' | 'done' | 'failed' | 'cancelled';

/** Progress of a past-submission import, persisted so an interrupted import can resume. */
export interface ImportProgress {
  platform: Platform;
  state: ImportState;
  /** Position in the platform's history (newest first). */
  offset: number;
  lastKey?: string;
  /** Newly stored submissions. */
  imported: number;
  /** Submissions already stored locally (captured live or imported earlier). */
  existing: number;
  /** Pending, unreadable or incomplete submissions that were not imported. */
  skipped: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
}

export function importProgressKey(platform: Platform): string {
  return `import.${platform}`;
}

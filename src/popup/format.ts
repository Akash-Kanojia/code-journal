import type { SubmissionStatus } from '../core/models/submission-result';
import { STATUS_LABELS } from '../core/journal/layout';
import { PLATFORM_INFO } from '../core/platform-info';
import type { ImportProgress } from '../core/types/import';
import type { RecentSubmissionView, StatusView } from '../core/types/status';

/** A running import that has not reported for this long was interrupted (tab closed). */
const STALE_IMPORT_MS = 2 * 60_000;

export interface ImportView {
  text: string;
  running: boolean;
  startLabel: string;
}

export function describeImport(progress: ImportProgress | undefined, now: number): ImportView {
  if (progress === undefined) {
    return { text: 'Not started', running: false, startLabel: 'Import from this tab' };
  }
  const counts = `${String(progress.imported)} imported, ${String(progress.existing)} already saved`;
  const skipped = progress.skipped > 0 ? `, ${String(progress.skipped)} skipped` : '';
  const interrupted = now - Date.parse(progress.updatedAt) > STALE_IMPORT_MS;
  switch (progress.state) {
    case 'running':
      return interrupted
        ? { text: `Interrupted (${counts})`, running: false, startLabel: 'Resume from this tab' }
        : { text: `Importing… ${counts}${skipped}`, running: true, startLabel: 'Importing…' };
    case 'done':
      return {
        text: `Done ${new Date(progress.finishedAt ?? progress.updatedAt).toLocaleDateString()}: ${counts}${skipped}`,
        running: false,
        startLabel: 'Check for new submissions',
      };
    case 'cancelled':
      return { text: `Stopped (${counts})`, running: false, startLabel: 'Resume from this tab' };
    case 'failed':
      return { text: `Failed (${counts})`, running: false, startLabel: 'Resume from this tab' };
  }
}

export function statusIcon(status: SubmissionStatus): {
  icon: string;
  tone: 'ok' | 'bad' | 'warn';
} {
  if (status === 'accepted') return { icon: '✓', tone: 'ok' };
  if (status === 'unknown') return { icon: '?', tone: 'warn' };
  return { icon: '✗', tone: 'bad' };
}

const SYNC_LABELS: Readonly<Record<RecentSubmissionView['syncStatus'], string>> = {
  pending: '⏳ pending',
  syncing: '⏳ syncing',
  synced: 'synced',
  failed: 'sync failed',
};

export function describeSubmission(item: RecentSubmissionView): { title: string; meta: string } {
  return {
    title: `${PLATFORM_INFO[item.platform].shortName} - ${item.title}`,
    meta: `${STATUS_LABELS[item.status]} · ${SYNC_LABELS[item.syncStatus]}`,
  };
}

export function describeSync(status: StatusView): string {
  const last = status.lastSync;
  if (status.settings.repository === undefined || status.settings.branch === undefined) {
    return 'Choose a repository and branch to start syncing. Submissions are kept locally until then.';
  }
  if (status.auth.status !== 'connected') {
    return 'Connect GitHub to sync. Submissions are kept locally until then.';
  }
  if (last === undefined) return '';
  if (last.error !== undefined) return `Last sync failed: ${last.error}`;
  const when = new Date(last.at).toLocaleTimeString();
  if (last.nextRetryAt !== undefined) {
    return `Last sync ${when}. Next retry ${new Date(last.nextRetryAt).toLocaleTimeString()}.`;
  }
  return `Last sync ${when}.`;
}

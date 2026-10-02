import type { SubmissionStatus } from '../core/models/submission-result';
import { STATUS_LABELS } from '../core/journal/layout';
import { PLATFORM_INFO } from '../core/platform-info';
import type { RecentSubmissionView, StatusView } from '../core/types/status';

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

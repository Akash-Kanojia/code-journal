import type { SubmissionStatus } from '../models/submission-result';
import type { ImportProgress } from './import';
import type { Platform } from './platform';
import type { RepositorySelection } from './messages';

export type SyncStatusView = 'pending' | 'syncing' | 'synced' | 'failed';

export type AuthView =
  | { status: 'disconnected' }
  | {
      status: 'pending';
      authorization: { userCode: string; verificationUri: string; expiresAt: string };
    }
  | { status: 'connected'; login: string; scope: string };

export interface RecentSubmissionView {
  key: string;
  platform: Platform;
  title: string;
  problemId: string;
  url: string;
  status: SubmissionStatus;
  submittedAt: string;
  syncStatus: SyncStatusView;
  lastError?: string;
  nextRetryAt?: string;
  path?: string;
}

/** What the popup shows. Never contains tokens or source code. */
export interface StatusView {
  auth: AuthView;
  authError?: string;
  clientIdConfigured: boolean;
  settings: {
    clientId: string;
    repository?: RepositorySelection;
    branch?: string;
    directory: string;
    allowPrivateRepositories: boolean;
  };
  counts: Record<SyncStatusView, number>;
  lastSync?: {
    at: string;
    synced: number;
    failed: number;
    blocked?: 'not_configured' | 'not_authenticated';
    nextRetryAt?: string;
    error?: string;
  };
  recent: RecentSubmissionView[];
  /** History imports by platform, when one was ever started. */
  imports: Partial<Record<Platform, ImportProgress>>;
}

export interface RepositoryView extends RepositorySelection {
  defaultBranch: string;
}

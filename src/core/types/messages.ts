import type { CodingSubmission } from '../models/coding-submission';
import { isCodingSubmission } from '../models/validate';
import { isPlatform, type Platform } from './platform';

/** Content script → background. The only message content scripts may send. */
export interface SubmissionCapturedRequest {
  type: 'SUBMISSION_CAPTURED';
  submission: CodingSubmission;
}

/** Content script → background: a batch of past submissions from a history import. */
export interface SubmissionsImportedRequest {
  type: 'SUBMISSIONS_IMPORTED';
  submissions: CodingSubmission[];
}

/** Content script → background: which of these submission ids are not stored yet? */
export interface FilterUnknownRequest {
  type: 'FILTER_UNKNOWN_SUBMISSIONS';
  platform: Platform;
  ids: string[];
}

export type ContentRequest =
  SubmissionCapturedRequest | SubmissionsImportedRequest | FilterUnknownRequest;

/** Popup → content script on a platform tab. */
export type ImportCommand = { type: 'START_IMPORT'; restart: boolean } | { type: 'CANCEL_IMPORT' };

export interface ImportAck {
  created: number;
  existing: number;
  /** Items that failed validation. */
  rejected: number;
}

/** Upper bound on one import batch, to keep messages small. */
export const MAX_IMPORT_BATCH = 100;

export interface RepositorySelection {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
}

export interface SettingsUpdate {
  repository?: RepositorySelection | null;
  branch?: string | null;
  directory?: string;
  /** GitHub OAuth App client id; overrides the build-time default. */
  clientId?: string | null;
  allowPrivateRepositories?: boolean;
}

/** Popup → background. Only accepted from extension pages. */
export type PopupRequest =
  | { type: 'GET_STATUS' }
  | { type: 'CONNECT_GITHUB' }
  | { type: 'CANCEL_CONNECT' }
  | { type: 'DISCONNECT_GITHUB' }
  | { type: 'LIST_REPOSITORIES' }
  | { type: 'LIST_BRANCHES'; owner: string; name: string }
  | { type: 'SAVE_SETTINGS'; settings: SettingsUpdate }
  | { type: 'RETRY_FAILED' }
  | { type: 'SYNC_NOW' };

export type RuntimeRequest = ContentRequest | PopupRequest;

export type RuntimeResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export interface CaptureAck {
  created: boolean;
  key: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSubmissionCapturedRequest(value: unknown): value is SubmissionCapturedRequest {
  return (
    isRecord(value) && value.type === 'SUBMISSION_CAPTURED' && isCodingSubmission(value.submission)
  );
}

/** Messages content scripts may send. Each is validated; submissions are untrusted input. */
export function isContentRequest(value: unknown): value is ContentRequest {
  if (isSubmissionCapturedRequest(value)) return true;
  if (!isRecord(value)) return false;
  if (value.type === 'SUBMISSIONS_IMPORTED') {
    // Items are validated one by one by the receiver, so one bad item does not drop the batch.
    return Array.isArray(value.submissions) && value.submissions.length <= MAX_IMPORT_BATCH;
  }
  if (value.type === 'FILTER_UNKNOWN_SUBMISSIONS') {
    return (
      isPlatform(value.platform) &&
      Array.isArray(value.ids) &&
      value.ids.length <= MAX_IMPORT_BATCH &&
      value.ids.every((id) => typeof id === 'string')
    );
  }
  return false;
}

export function isImportCommand(value: unknown): value is ImportCommand {
  return (
    isRecord(value) &&
    ((value.type === 'START_IMPORT' && typeof value.restart === 'boolean') ||
      value.type === 'CANCEL_IMPORT')
  );
}

const SIMPLE_POPUP_TYPES = new Set([
  'GET_STATUS',
  'CONNECT_GITHUB',
  'CANCEL_CONNECT',
  'DISCONNECT_GITHUB',
  'LIST_REPOSITORIES',
  'RETRY_FAILED',
  'SYNC_NOW',
]);

function isRepositorySelection(value: unknown): value is RepositorySelection {
  return (
    isRecord(value) &&
    typeof value.owner === 'string' &&
    typeof value.name === 'string' &&
    typeof value.fullName === 'string' &&
    typeof value.private === 'boolean'
  );
}

function isSettingsUpdate(value: unknown): value is SettingsUpdate {
  if (!isRecord(value)) return false;
  const nullableString = (v: unknown): boolean =>
    v === undefined || v === null || typeof v === 'string';
  return (
    (value.repository === undefined ||
      value.repository === null ||
      isRepositorySelection(value.repository)) &&
    nullableString(value.branch) &&
    (value.directory === undefined || typeof value.directory === 'string') &&
    nullableString(value.clientId) &&
    (value.allowPrivateRepositories === undefined ||
      typeof value.allowPrivateRepositories === 'boolean')
  );
}

export function isPopupRequest(value: unknown): value is PopupRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (SIMPLE_POPUP_TYPES.has(value.type)) return true;
  if (value.type === 'LIST_BRANCHES') {
    return typeof value.owner === 'string' && typeof value.name === 'string';
  }
  if (value.type === 'SAVE_SETTINGS') return isSettingsUpdate(value.settings);
  return false;
}

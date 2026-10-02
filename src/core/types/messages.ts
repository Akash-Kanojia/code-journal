import type { CodingSubmission } from '../models/coding-submission';
import { isCodingSubmission } from '../models/validate';

/** Content script → background. The only message content scripts may send. */
export interface SubmissionCapturedRequest {
  type: 'SUBMISSION_CAPTURED';
  submission: CodingSubmission;
}

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

export type RuntimeRequest = SubmissionCapturedRequest | PopupRequest;

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

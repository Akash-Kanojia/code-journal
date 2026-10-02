import type { RepositorySelection, SettingsUpdate } from '../core/types/messages';
import { normalizeBaseDirectory } from '../core/journal/layout';
import { ext } from '../ext';

/** Non-secret configuration, kept in extension storage (storage.local). The token is stored separately. */
export interface Settings {
  clientId?: string;
  repository?: RepositorySelection;
  branch?: string;
  /** Base directory inside the repository; "" is the root. */
  directory: string;
  allowPrivateRepositories: boolean;
}

const KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = { directory: '', allowPrivateRepositories: true };

export function buildTimeClientId(): string | undefined {
  const id = typeof __GITHUB_CLIENT_ID__ === 'string' ? __GITHUB_CLIENT_ID__.trim() : '';
  return id === '' ? undefined : id;
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await ext.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function applySettingsUpdate(current: Settings, update: SettingsUpdate): Settings {
  const next: Settings = { ...current };
  if (update.repository !== undefined) {
    if (update.repository === null) delete next.repository;
    else next.repository = update.repository;
    // A different repository's branch list is unrelated.
    if (
      update.repository?.fullName !== current.repository?.fullName &&
      update.branch === undefined
    ) {
      delete next.branch;
    }
  }
  if (update.branch !== undefined) {
    if (update.branch === null || update.branch.trim() === '') delete next.branch;
    else next.branch = update.branch.trim();
  }
  if (update.directory !== undefined) next.directory = normalizeBaseDirectory(update.directory);
  if (update.clientId !== undefined) {
    const id = update.clientId?.trim() ?? '';
    if (id === '') delete next.clientId;
    else next.clientId = id;
  }
  if (update.allowPrivateRepositories !== undefined) {
    next.allowPrivateRepositories = update.allowPrivateRepositories;
  }
  return next;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await ext.storage.local.set({ [KEY]: settings });
}

export function effectiveClientId(settings: Settings): string | undefined {
  return settings.clientId ?? buildTimeClientId();
}

/** `repo` is needed to write to private repositories; `public_repo` limits access to public ones. */
export function oauthScope(settings: Settings): string {
  return settings.allowPrivateRepositories ? 'repo' : 'public_repo';
}

import type { ImportCommand, RepositorySelection, RuntimeResponse } from '../core/types/messages';
import type { RepositoryView, StatusView } from '../core/types/status';
import { ext } from '../ext';
import { call } from './api';
import { describeImport, describeSubmission, describeSync, statusIcon } from './format';

function el<T extends HTMLElement = HTMLElement>(
  id: string,
  kind: abstract new () => T = HTMLElement as unknown as abstract new () => T,
): T {
  const element = document.getElementById(id);
  if (!(element instanceof kind)) throw new Error(`Missing #${id}`);
  return element;
}

const ui = {
  authStatus: el('auth-status'),
  authPending: el('auth-pending'),
  authDisconnected: el('auth-disconnected'),
  authConnected: el('auth-connected'),
  authError: el('auth-error'),
  userCode: el('user-code'),
  openGithub: el('open-github', HTMLButtonElement),
  cancelConnect: el('cancel-connect', HTMLButtonElement),
  connect: el('connect', HTMLButtonElement),
  disconnect: el('disconnect', HTMLButtonElement),
  allowPrivate: el('allow-private', HTMLInputElement),
  clientId: el('client-id', HTMLInputElement),
  clientIdDetails: el('client-id-details', HTMLDetailsElement),
  repoSelect: el('repo-select', HTMLSelectElement),
  branchSelect: el('branch-select', HTMLSelectElement),
  directory: el('directory', HTMLInputElement),
  loadRepos: el('load-repos', HTMLButtonElement),
  saveSettings: el('save-settings', HTMLButtonElement),
  settingsMessage: el('settings-message'),
  countPending: el('count-pending'),
  countSynced: el('count-synced'),
  countFailed: el('count-failed'),
  syncInfo: el('sync-info'),
  syncNow: el('sync-now', HTMLButtonElement),
  retryFailed: el('retry-failed', HTMLButtonElement),
  recent: el('recent'),
  importStatus: el('import-status'),
  importStart: el('import-start', HTMLButtonElement),
  importCancel: el('import-cancel', HTMLButtonElement),
  importError: el('import-error'),
};

let status: StatusView | undefined;
let repositories: RepositoryView[] = [];
let settingsDirty = false;
let pollTimer: number | undefined;

function show(element: HTMLElement, visible: boolean): void {
  element.hidden = !visible;
}

function message(element: HTMLElement, text: string | undefined): void {
  element.textContent = text ?? '';
  show(element, text !== undefined && text !== '');
}

function option(value: string, label: string, selected = false): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.selected = selected;
  return o;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderAuth(view: StatusView): void {
  const { auth } = view;
  show(ui.authPending, auth.status === 'pending');
  show(ui.authDisconnected, auth.status === 'disconnected');
  show(ui.authConnected, auth.status === 'connected');
  if (auth.status === 'connected') {
    ui.authStatus.textContent = auth.login === '' ? 'Connected' : `Connected as ${auth.login}`;
  } else if (auth.status === 'pending') {
    ui.authStatus.textContent = 'Waiting for authorization…';
    ui.userCode.textContent = auth.authorization.userCode;
  } else {
    ui.authStatus.textContent = 'Not connected';
  }
  ui.allowPrivate.checked = view.settings.allowPrivateRepositories;
  if (document.activeElement !== ui.clientId) ui.clientId.value = view.settings.clientId;
  // Only prompt for a client id when the build does not provide one.
  ui.clientIdDetails.open = !view.clientIdConfigured;
  message(ui.authError, view.authError);
  const connected = auth.status === 'connected';
  ui.loadRepos.disabled = !connected;
  ui.repoSelect.disabled = !connected;
  ui.branchSelect.disabled = !connected;
}

function renderRepositorySelection(view: StatusView): void {
  if (settingsDirty) return;
  const { repository, branch, directory } = view.settings;
  if (repositories.length === 0) {
    ui.repoSelect.replaceChildren(
      option('', '—'),
      ...(repository === undefined ? [] : [option(repository.fullName, repository.fullName, true)]),
    );
  }
  if (ui.branchSelect.options.length <= 1) {
    ui.branchSelect.replaceChildren(
      option('', '—'),
      ...(branch === undefined ? [] : [option(branch, branch, true)]),
    );
  }
  if (document.activeElement !== ui.directory) ui.directory.value = directory;
}

function renderSync(view: StatusView): void {
  ui.countPending.textContent = String(view.counts.pending + view.counts.syncing);
  ui.countSynced.textContent = String(view.counts.synced);
  ui.countFailed.textContent = String(view.counts.failed);
  ui.syncInfo.textContent = describeSync(view);
  ui.retryFailed.disabled = view.counts.failed === 0;
  ui.syncNow.disabled = view.counts.pending === 0;
}

function renderRecent(view: StatusView): void {
  if (view.recent.length === 0) {
    const li = document.createElement('li');
    li.className = 'meta';
    li.textContent = 'No submissions captured yet.';
    ui.recent.replaceChildren(li);
    return;
  }
  ui.recent.replaceChildren(
    ...view.recent.map((item) => {
      const li = document.createElement('li');
      const { icon, tone } = statusIcon(item.status);
      const iconEl = document.createElement('span');
      iconEl.className = tone;
      iconEl.textContent = icon;
      const { title, meta } = describeSubmission(item);
      const titleEl = document.createElement('a');
      titleEl.className = 'title';
      titleEl.textContent = title;
      titleEl.href = item.url;
      titleEl.target = '_blank';
      titleEl.title = item.lastError ?? title;
      const metaEl = document.createElement('span');
      metaEl.className = `meta${item.syncStatus === 'failed' ? ' bad' : ''}`;
      metaEl.textContent = meta;
      li.append(iconEl, titleEl, metaEl);
      return li;
    }),
  );
}

function renderImport(view: StatusView): void {
  const progress = view.imports.leetcode;
  const described = describeImport(progress, Date.now());
  ui.importStatus.textContent = described.text;
  ui.importStart.textContent = described.startLabel;
  ui.importStart.disabled = described.running;
  show(ui.importCancel, described.running);
  if (progress?.state === 'failed') message(ui.importError, progress.error);
}

/** Sends an import command to the content script of the active tab. */
async function commandActiveTab(command: ImportCommand): Promise<void> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('No active tab');
  let response: RuntimeResponse | undefined;
  try {
    response = await ext.tabs.sendMessage<ImportCommand, RuntimeResponse | undefined>(
      tab.id,
      command,
    );
  } catch {
    throw new Error('Open leetcode.com in this tab (signed in), reload it, then try again.');
  }
  if (response === undefined)
    throw new Error('The page did not respond. Reload the tab and try again.');
  if (!response.ok) throw new Error(response.error);
}

async function refresh(): Promise<void> {
  try {
    status = await call<StatusView>({ type: 'GET_STATUS' });
  } catch (error) {
    ui.authStatus.textContent = 'Unavailable';
    message(ui.authError, errorText(error));
    return;
  }
  renderAuth(status);
  renderRepositorySelection(status);
  renderSync(status);
  renderRecent(status);
  renderImport(status);
  schedulePoll(status.auth.status === 'pending' ? 2000 : 5000);
}

function schedulePoll(ms: number): void {
  if (pollTimer !== undefined) clearTimeout(pollTimer);
  pollTimer = window.setTimeout(() => void refresh(), ms);
}

async function loadRepositories(): Promise<void> {
  ui.loadRepos.disabled = true;
  message(ui.settingsMessage, 'Loading repositories…');
  try {
    repositories = await call<RepositoryView[]>({ type: 'LIST_REPOSITORIES' });
    const current = status?.settings.repository?.fullName;
    ui.repoSelect.replaceChildren(
      option('', repositories.length === 0 ? 'No writable repositories' : 'Select a repository'),
      ...repositories.map((r) =>
        option(r.fullName, `${r.fullName}${r.private ? ' (private)' : ''}`, r.fullName === current),
      ),
    );
    message(ui.settingsMessage, undefined);
    if (current !== undefined) await loadBranches(current, status?.settings.branch);
  } catch (error) {
    message(ui.settingsMessage, errorText(error));
  } finally {
    ui.loadRepos.disabled = false;
  }
}

function selectedRepository(): RepositoryView | RepositorySelection | undefined {
  const fullName = ui.repoSelect.value;
  if (fullName === '') return undefined;
  return (
    repositories.find((r) => r.fullName === fullName) ??
    (status?.settings.repository?.fullName === fullName ? status.settings.repository : undefined)
  );
}

async function loadBranches(fullName: string, preferred?: string): Promise<void> {
  const repository = repositories.find((r) => r.fullName === fullName);
  if (repository === undefined) return;
  ui.branchSelect.replaceChildren(option('', 'Loading…'));
  try {
    const branches = await call<string[]>({
      type: 'LIST_BRANCHES',
      owner: repository.owner,
      name: repository.name,
    });
    const choice = preferred ?? repository.defaultBranch;
    const names = branches.length === 0 ? [repository.defaultBranch] : branches;
    ui.branchSelect.replaceChildren(
      ...names.map((b) =>
        option(b, branches.length === 0 ? `${b} (new, empty repository)` : b, b === choice),
      ),
    );
  } catch (error) {
    ui.branchSelect.replaceChildren(option('', '—'));
    message(ui.settingsMessage, errorText(error));
  }
}

async function run(button: HTMLButtonElement, action: () => Promise<unknown>): Promise<void> {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    message(ui.authError, errorText(error));
  } finally {
    button.disabled = false;
    await refresh();
  }
}

ui.connect.addEventListener('click', () => {
  void run(ui.connect, async () => {
    await call({
      type: 'SAVE_SETTINGS',
      settings: { clientId: ui.clientId.value, allowPrivateRepositories: ui.allowPrivate.checked },
    });
    const authorization = await call<{ verificationUri: string }>({ type: 'CONNECT_GITHUB' });
    await ext.tabs.create({ url: authorization.verificationUri });
  });
});

ui.openGithub.addEventListener('click', () => {
  if (status?.auth.status === 'pending') {
    void ext.tabs.create({ url: status.auth.authorization.verificationUri });
  }
});

ui.cancelConnect.addEventListener('click', () => {
  void run(ui.cancelConnect, () => call({ type: 'CANCEL_CONNECT' }));
});

ui.disconnect.addEventListener('click', () => {
  void run(ui.disconnect, async () => {
    await call({ type: 'DISCONNECT_GITHUB' });
    repositories = [];
  });
});

ui.loadRepos.addEventListener('click', () => void loadRepositories());

ui.repoSelect.addEventListener('change', () => {
  settingsDirty = true;
  if (ui.repoSelect.value !== '') void loadBranches(ui.repoSelect.value);
  else ui.branchSelect.replaceChildren(option('', '—'));
});
ui.branchSelect.addEventListener('change', () => {
  settingsDirty = true;
});
ui.directory.addEventListener('input', () => {
  settingsDirty = true;
});

ui.saveSettings.addEventListener('click', () => {
  void (async () => {
    ui.saveSettings.disabled = true;
    try {
      const repository = selectedRepository();
      await call({
        type: 'SAVE_SETTINGS',
        settings: {
          repository:
            repository === undefined
              ? null
              : {
                  owner: repository.owner,
                  name: repository.name,
                  fullName: repository.fullName,
                  private: repository.private,
                },
          branch: ui.branchSelect.value === '' ? null : ui.branchSelect.value,
          directory: ui.directory.value,
        },
      });
      settingsDirty = false;
      message(ui.settingsMessage, 'Saved.');
    } catch (error) {
      message(ui.settingsMessage, errorText(error));
    } finally {
      ui.saveSettings.disabled = false;
      await refresh();
    }
  })();
});

ui.importStart.addEventListener('click', () => {
  message(ui.importError, undefined);
  void commandActiveTab({ type: 'START_IMPORT', restart: false })
    .catch((error: unknown) => {
      message(ui.importError, errorText(error));
    })
    .finally(() => void refresh());
});
ui.importCancel.addEventListener('click', () => {
  void commandActiveTab({ type: 'CANCEL_IMPORT' })
    .catch((error: unknown) => {
      message(ui.importError, errorText(error));
    })
    .finally(() => void refresh());
});

ui.syncNow.addEventListener('click', () => {
  void run(ui.syncNow, () => call({ type: 'SYNC_NOW' }));
});
ui.retryFailed.addEventListener('click', () => {
  void run(ui.retryFailed, () => call({ type: 'RETRY_FAILED' }));
});

void refresh().then(() => {
  if (status?.auth.status === 'connected') void loadRepositories();
});

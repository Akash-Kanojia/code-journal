import type {
  HistoryImporter,
  HistoryImportSink,
  PlatformAdapter,
} from '../core/adapters/platform-adapter';
import type { Logger } from '../core/logger';
import { importProgressKey, type ImportProgress } from '../core/types/import';
import {
  isImportCommand,
  type ContentRequest,
  type ImportAck,
  type RuntimeResponse,
} from '../core/types/messages';
import { ext } from '../ext';

async function send<T>(request: ContentRequest): Promise<T> {
  const response = await ext.runtime.sendMessage<ContentRequest, RuntimeResponse<T> | undefined>(
    request,
  );
  if (response === undefined) throw new Error('No response from the background worker');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

function createSink(adapter: PlatformAdapter): HistoryImportSink {
  const key = importProgressKey(adapter.platform);
  return {
    filterUnknown: (ids) =>
      send<string[]>({ type: 'FILTER_UNKNOWN_SUBMISSIONS', platform: adapter.platform, ids }),
    deliver: async (submissions) => {
      const ack = await send<ImportAck>({ type: 'SUBMISSIONS_IMPORTED', submissions });
      if (ack.rejected > 0)
        throw new Error(`${String(ack.rejected)} imported submissions were rejected`);
    },
    loadProgress: async () => (await ext.storage.local.get(key))[key] as ImportProgress | undefined,
    saveProgress: (progress) => ext.storage.local.set({ [key]: progress }),
  };
}

/**
 * Lets the popup start/cancel a history import in this tab. The import runs here because it
 * needs the user's signed-in session on the platform (same-origin requests).
 */
export function listenForImportCommands(adapter: PlatformAdapter, logger: Logger): void {
  let importer: HistoryImporter | undefined;
  ext.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Only extension pages (the popup) may control the import.
    if (sender.id !== ext.runtime.id || sender.tab !== undefined || !isImportCommand(message)) {
      return false;
    }
    let response: RuntimeResponse;
    if (adapter.createHistoryImporter === undefined) {
      response = { ok: false, error: `History import is not available for ${adapter.platform}` };
    } else if (message.type === 'CANCEL_IMPORT') {
      importer?.cancel();
      response = { ok: true, data: null };
    } else {
      importer ??= adapter.createHistoryImporter(createSink(adapter));
      if (!importer.isRunning()) {
        void importer.start(message.restart).catch((error: unknown) => {
          logger.error('History import crashed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      response = { ok: true, data: null };
    }
    sendResponse(response);
    return false;
  });
}

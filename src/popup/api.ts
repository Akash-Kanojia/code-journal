import type { PopupRequest, RuntimeResponse } from '../core/types/messages';
import { ext } from '../ext';

/** Sends a request to the background worker; rejects with its error message. */
export async function call<T>(request: PopupRequest): Promise<T> {
  const response = await ext.runtime.sendMessage<PopupRequest, RuntimeResponse<T> | undefined>(
    request,
  );
  if (response === undefined) throw new Error('No response from the background worker');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

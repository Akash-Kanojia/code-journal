/**
 * Messages posted from a MAIN-world page script to the isolated content script.
 * They carry only URL, method, status and the bodies of submission endpoints —
 * never request headers, cookies or credentials.
 */
export interface BridgeMessage {
  channel: string;
  url: string;
  method: string;
  status: number;
  /** Text request body (e.g. JSON). */
  requestBody?: string;
  /** Form request body (FormData / URLSearchParams), text fields only. */
  requestForm?: Record<string, string>;
  responseBody: string;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

export function isBridgeMessage(value: unknown, channel: string): value is BridgeMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const m = value as Partial<Record<keyof BridgeMessage, unknown>>;
  return (
    m.channel === channel &&
    typeof m.url === 'string' &&
    typeof m.method === 'string' &&
    typeof m.status === 'number' &&
    typeof m.responseBody === 'string' &&
    (m.requestBody === undefined || typeof m.requestBody === 'string') &&
    (m.requestForm === undefined || isStringRecord(m.requestForm))
  );
}

/** Subscribes to bridge messages on `window`, accepting only same-window, same-origin posts. */
export function subscribeToBridge(
  channel: string,
  handler: (message: BridgeMessage) => void,
): () => void {
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (!isBridgeMessage(event.data, channel)) return;
    handler(event.data);
  };
  window.addEventListener('message', onMessage);
  return () => {
    window.removeEventListener('message', onMessage);
  };
}

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses JSON text, returning undefined instead of throwing. */
export function parseJson(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Accepts a non-empty string, or a finite number converted to string. */
export function readId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Reads a finite, non-negative integer. */
export function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** Drops undefined-valued keys so results satisfy `exactOptionalPropertyTypes`. */
export function omitUndefined<T extends Record<string, unknown>>(value: T): Defined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Defined<T>;
}

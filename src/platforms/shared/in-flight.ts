/**
 * Correlates asynchronous platform events (submit response, result polls) by submission id.
 * Each submission's events run strictly in order, and a final result is handled once.
 */
export class InFlightSubmissions<C> {
  private readonly entries = new Map<string, { context: C; chain: Promise<void> }>();

  /** Registers a submission; `init` runs first in its chain (e.g. resolving the problem). */
  start(id: string, context: C, init: (context: C) => Promise<void>): void {
    const entry = { context, chain: Promise.resolve() };
    entry.chain = init(context).catch(() => undefined);
    this.entries.set(id, entry);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Runs `step` after every earlier step for the same id. `context` is undefined for ids that
   * were never started (or already finished). Step failures do not break later steps.
   */
  enqueue(id: string, step: (context: C | undefined) => Promise<void> | void): void {
    const entry = this.entries.get(id);
    const run = async (): Promise<void> => {
      await step(this.entries.get(id) === entry ? entry?.context : undefined);
    };
    const next = (entry?.chain ?? Promise.resolve()).then(run).catch(() => undefined);
    if (entry !== undefined) entry.chain = next;
  }

  /** Removes the submission; returns its context only the first time (dedupes final results). */
  finish(id: string): C | undefined {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    return entry?.context;
  }
}

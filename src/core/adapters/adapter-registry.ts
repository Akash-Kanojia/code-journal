import type { Platform } from '../types/platform';
import type { PlatformAdapter } from './platform-adapter';

export class AdapterRegistry {
  private readonly adapters = new Map<Platform, PlatformAdapter>();

  register(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(`Adapter already registered for platform "${adapter.platform}"`);
    }
    this.adapters.set(adapter.platform, adapter);
  }

  get(platform: Platform): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  /** Returns the first registered adapter that can handle the URL. */
  findForUrl(url: URL): PlatformAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(url)) {
        return adapter;
      }
    }
    return undefined;
  }

  list(): readonly PlatformAdapter[] {
    return [...this.adapters.values()];
  }
}

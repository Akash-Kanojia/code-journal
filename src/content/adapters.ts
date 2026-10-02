import { AdapterRegistry } from '../core/adapters/adapter-registry';
import { createGfgAdapter } from '../platforms/gfg/gfg-adapter';
import { createLeetCodeAdapter } from '../platforms/leetcode/leetcode-adapter';

/** Every supported platform. Adding a platform means adding its adapter here. */
export function createAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(createLeetCodeAdapter());
  registry.register(createGfgAdapter());
  return registry;
}

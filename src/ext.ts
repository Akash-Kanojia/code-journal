/**
 * The extension API namespace. Firefox exposes the promise-based `browser` namespace
 * (its `chrome` alias is callback-based); Chrome only has `chrome`, which returns promises in MV3.
 */
export const ext: typeof chrome =
  (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome;

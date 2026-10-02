import { defineConfig } from 'vite';

/**
 * MV3 constraints drive a multi-pass build (one entry per pass):
 * - background: ES module service worker (manifest declares "type": "module").
 * - content scripts (isolated and MAIN world) cannot use ES imports, so each is a single IIFE.
 * - popup: a classic script loaded by popup.html.
 *
 * Select the entry with `vite build --mode <entry>`; `npm run build` runs them all.
 */
const entries = {
  background: { file: 'src/background/index.ts', format: 'es' },
  content: { file: 'src/content/index.ts', format: 'iife' },
  // MAIN-world scripts run in the page and cannot import extension modules either.
  'leetcode-page': { file: 'src/platforms/leetcode/leetcode-page.ts', format: 'iife' },
  'gfg-page': { file: 'src/platforms/gfg/gfg-page.ts', format: 'iife' },
  popup: { file: 'src/popup/popup.ts', format: 'iife' },
} as const;

type EntryName = keyof typeof entries;

// Node globals without depending on @types/node.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

function isEntryName(mode: string): mode is EntryName {
  return mode in entries;
}

export default defineConfig(({ mode }) => {
  if (!isEntryName(mode)) {
    throw new Error(
      `Unknown build mode "${mode}". Expected one of: ${Object.keys(entries).join(', ')}`,
    );
  }
  const entry = entries[mode];

  return {
    publicDir: 'public',
    define: {
      // Public OAuth client id (not a secret). Optional: it can also be entered in the popup.
      __GITHUB_CLIENT_ID__: JSON.stringify(env?.GITHUB_CLIENT_ID ?? ''),
    },
    build: {
      outDir: 'dist',
      // Only the first pass clears dist; later passes add to it.
      emptyOutDir: mode === 'background',
      target: 'es2022',
      sourcemap: true,
      minify: false,
      lib: {
        entry: entry.file,
        formats: [entry.format],
        name: 'CodeJournal',
        fileName: () => `${mode}.js`,
      },
    },
  };
});

// Minimal declaration so the smoke test can check for dist/ without depending on @types/node.
declare module 'node:fs' {
  export function existsSync(path: URL | string): boolean;
}

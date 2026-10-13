// Produces store-ready artifacts in artifacts/:
//   node scripts/package.js firefox   → code-journal-firefox-<version>.zip (upload to AMO)
//   node scripts/package.js chrome    → code-journal-chrome-<version>.zip  (upload to Chrome Web Store)
//   node scripts/package.js source    → code-journal-source-<version>.zip  (AMO source-code upload)
//
// Release builds must embed the GitHub OAuth App client id (GITHUB_CLIENT_ID); otherwise every
// user would have to register their own OAuth App. Pass --allow-missing-client-id to override.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });

const target = process.argv[2];
const allowMissingClientId = process.argv.includes('--allow-missing-client-id');
if (!['firefox', 'chrome', 'source'].includes(target ?? '')) {
  console.error(
    'Usage: node scripts/package.js <firefox|chrome|source> [--allow-missing-client-id]',
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(new URL('public/manifest.json', root), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(
    `Version mismatch: public/manifest.json is ${manifest.version}, package.json is ${pkg.version}. ` +
      'Bump both before packaging; stores reject a version they have already seen.',
  );
  process.exit(1);
}
const { version } = manifest;
mkdirSync(new URL('artifacts/', root), { recursive: true });

if (target === 'source') {
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (dirty.trim() !== '') {
    console.warn('Warning: uncommitted changes are NOT included in the source archive.');
  }
  run('git', [
    'archive',
    '--format=zip',
    `--output=artifacts/code-journal-source-${version}.zip`,
    'HEAD',
  ]);
  console.log(`artifacts/code-journal-source-${version}.zip`);
  process.exit(0);
}

if (!process.env.GITHUB_CLIENT_ID && !allowMissingClientId) {
  console.error(
    'GITHUB_CLIENT_ID is not set. Release builds should embed your OAuth App client id:\n' +
      `  GITHUB_CLIENT_ID=Ov23… npm run package:${target}\n` +
      '(or pass --allow-missing-client-id to build one where users enter their own).',
  );
  process.exit(1);
}

run('npm', ['run', target === 'firefox' ? 'build:firefox' : 'build']);
const sourceDir = target === 'firefox' ? 'dist-firefox' : 'dist';
const filename = `code-journal-${target}-${version}.zip`;
run('npx', [
  'web-ext',
  'build',
  '--source-dir',
  sourceDir,
  '--artifacts-dir',
  'artifacts',
  '--filename',
  filename,
  '--overwrite-dest',
  '--ignore-files',
  '**/*.map',
]);
console.log(`artifacts/${filename}`);

// Derives a Firefox build (dist-firefox/) from the Chrome build in dist/.
// The bundles are identical; only the manifest differs:
// - Firefox runs MV3 backgrounds as event pages (`background.scripts`), not service workers.
// - Firefox needs an add-on id, and MAIN-world content scripts need Firefox 128+ (140 is required for data_collection_permissions).
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = new URL('dist/', root);
const target = new URL('dist-firefox/', root);

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

const manifest = JSON.parse(readFileSync(new URL('manifest.json', source), 'utf8'));
delete manifest.minimum_chrome_version;
manifest.background = { scripts: ['background.js'], type: 'module' };
manifest.browser_specific_settings = {
  gecko: {
    // Permanent once published to addons.mozilla.org; never change it after the first upload.
    id: 'code-journal@akash-kanojia',
    strict_min_version: '140.0',
    // No developer server, but submitted code (page content) is sent to the user's GitHub
    // repository, a third party, so it is declared. See PRIVACY.md.
    data_collection_permissions: { required: ['websiteContent'] },
  },
};
writeFileSync(new URL('manifest.json', target), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Firefox build written to dist-firefox/');

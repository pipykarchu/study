import {readFile, writeFile, mkdir, readdir, copyFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hosting = JSON.parse(await readFile(resolve(root, '.openai/hosting.json'), 'utf8'));
if (hosting.static != null || hosting.d1 !== 'DB') throw new Error('Cloud build requires Worker hosting with d1:"DB" and without static configuration.');
const worker = await readFile(resolve(root, 'worker/index.js'), 'utf8');
const learning = await readFile(resolve(root, 'dist/learning.js'), 'utf8');
if (!learning.includes('})(window);')) throw new Error('Learning validator source changed; review the cloud validator wrapper.');
const validator = `function validateLearningSnapshot(raw) {\nconst window = {localStorage: {getItem() {return null;}, setItem() {}}, dispatchEvent() {}, CustomEvent: class {constructor() {}}};\n${learning}\nwindow.StudyLearning.importData(raw);\nreturn window.StudyLearning.exportData();\n}`;
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp'};
const assets = {};
for (const entry of (await readdir(resolve(root, 'dist'), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
  const extension = extname(entry.name);
  if (!entry.isFile() || !types[extension] || entry.name.startsWith('.')) continue;
  const binary = extension === '.png' || extension === '.webp';
  const body = await readFile(resolve(root, 'dist', entry.name));
  if (binary && !body.length) throw new Error('Empty image asset: ' + entry.name);
  assets['/' + entry.name] = {body: body.toString(binary ? 'base64' : 'utf8'), type: types[extension], ...(binary ? {encoding: 'base64'} : {})};
}
if (!assets['/index.html']) throw new Error('Missing learning website index.html.');
const output = worker.replace('/*__LEARNING_VALIDATOR__*/', () => validator).replace('/*__STATIC_ASSETS__*/', () => 'const STATIC_ASSETS = ' + JSON.stringify(assets) + ';');
await mkdir(resolve(root, 'dist/server'), {recursive: true});
await mkdir(resolve(root, 'dist/.openai'), {recursive: true});
await writeFile(resolve(root, 'dist/server/index.js'), output);
await writeFile(resolve(root, 'dist/.openai/hosting.json'), JSON.stringify(hosting, null, 2) + '\n');

// Sites packages source drizzle/ into dist/.openai/drizzle and applies pending schema migrations.
// This immutable initial migration and fixed journal timestamp are deterministic across builds.
await mkdir(resolve(root, 'drizzle/meta'), {recursive: true});
await copyFile(resolve(root, 'migrations/0000_study_state.sql'), resolve(root, 'drizzle/0000_study_state.sql'));
await writeFile(resolve(root, 'drizzle/meta/_journal.json'), JSON.stringify({version: '7', dialect: 'sqlite', entries: [{idx: 0, version: '6', when: 1792371600000, tag: '0000_study_state', breakpoints: true}]}, null, 2) + '\n');
console.log(`Built single-file Sites Worker with ${Object.keys(assets).length} embedded assets and one schema-only D1 migration.`);

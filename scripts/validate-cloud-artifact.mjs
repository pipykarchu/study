import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = await readFile(resolve(root, 'dist/server/index.js'), 'utf8');
const built = JSON.parse(await readFile(resolve(root, 'dist/.openai/hosting.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, '.openai/hosting.json'), 'utf8'));
assert.deepEqual(built, manifest);
assert.equal(built.static, undefined);
assert.equal(built.d1, 'DB');
assert.ok(!source.includes('/*__LEARNING_VALIDATOR__*/'));
assert.ok(!source.includes('/*__STATIC_ASSETS__*/'));
const {default: worker} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
assert.equal(typeof worker?.fetch, 'function');
const email = 'artifact-owner@example.test';
const env = {STUDY_OWNER_EMAIL_SHA256: createHash('sha256').update(email).digest('hex')};
const headers = {'oai-authenticated-user-id': 'artifact-owner', 'oai-authenticated-user-email': email};
for (const path of ['index.html', 'styles.css', 'learning.js', 'coach.js', 'app.js']) {
  const response = await worker.fetch(new Request('https://artifact.example.test/' + path, {headers}), env);
  assert.equal(response.status, 200);
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(await response.text()), hash(await readFile(resolve(root, 'dist', path), 'utf8')), 'Stale embedded asset: ' + path + '; rebuild the cloud Worker.');
}
assert.equal((await worker.fetch(new Request('https://artifact.example.test/'), env)).status, 401);
assert.equal(await readFile(resolve(root, 'drizzle/0000_study_state.sql'), 'utf8'), await readFile(resolve(root, 'migrations/0000_study_state.sql'), 'utf8'));
const journal = JSON.parse(await readFile(resolve(root, 'drizzle/meta/_journal.json'), 'utf8'));
assert.equal(journal.dialect, 'sqlite');
assert.equal(journal.entries[0].tag, '0000_study_state');
console.log('Cloud artifact validated: ESM Worker, current embedded assets, owner gate, D1 manifest and migration journal.');

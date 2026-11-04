import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const ima = await read('../worker/ima.js');
const worker = await read('../worker/index.js');
const roles = ['apple', 'sheep', 'bear'];
const profiles = ['product', 'coding', 'fde', 'custom', 'mobile'];
const origin = 'https://study.test';
const email = 'synthetic-owner@example.test';
const env = {
  STUDY_OWNER_EMAIL_SHA256: createHash('sha256').update(email).digest('hex'),
  IMA_OPENAPI_CLIENTID: 'synthetic-client', IMA_OPENAPI_APIKEY: 'synthetic-key'
};
const operations = {
  libraries: {},
  search: {kbId: 'synthetic-library', query: 'synthetic query'},
  'save-note': {kbId: 'synthetic-library', title: 'Synthetic note', content: 'Test only'}
};

// Execute the real Worker routing, identity, origin and ima validation code.
// Identity headers and secrets are synthetic; all upstream fetches are mocked.
function harness() {
  const calls = [];
  const context = vm.createContext({
    Request, Response, URL, TextEncoder, TextDecoder, AbortController,
    setTimeout, clearTimeout, crypto: webcrypto,
    fetch: async (url, options) => {
      assert.ok(url.startsWith('https://ima.qq.com/openapi/'));
      calls.push({url, body: JSON.parse(options.body)});
      const data = url.endsWith('/import_doc') ? {note_id: 'synthetic-note'} : {};
      return new Response(JSON.stringify({code: 0, data}));
    }
  });
  const source = worker.replace('/*__IMA_CONNECTOR__*/', () => ima)
    .replace('export function validateSnapshot', 'function validateSnapshot')
    .replace('export default', 'globalThis.worker =');
  vm.runInContext(source, context);
  return {
    calls,
    request(operation, scope, query = '', extra = {}) {
      return context.worker.fetch(new Request(`${origin}/api/ima/${operation}${query}`, {
        method: 'POST', headers: {
          'Content-Type': 'application/json', Origin: origin,
          'oai-authenticated-user-id': 'synthetic-owner',
          'oai-authenticated-user-email': email
        }, body: JSON.stringify({...operations[operation], ...scope, ...extra})
      }), env);
    }
  };
}

test('static contract: documented role/profile enums exactly match imaScope', async () => {
  const doc = await read('../docs/ima-connection.md');
  const line = doc.split('\n').find(line => line.startsWith('以下为同源 POST'));
  assert.ok(line, 'POST scope contract must be documented');
  for (const [field, expected] of [['roleId', roles], ['profileId', profiles]]) {
    const section = line.match(new RegExp('`' + field + '`（([^）]+)）'));
    assert.ok(section, `${field} enum must be documented`);
    const documented = [...section[1].matchAll(/`([^`]+)`/g)].map(match => match[1]);
    const code = ima.match(new RegExp("\\[([^\\]]+)\\]\\.includes\\(body\\." + field + "\\)"));
    assert.ok(code, `${field} whitelist must be located in imaScope`);
    const implemented = [...code[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    assert.deepEqual(documented, expected);
    assert.deepEqual(documented, implemented);
  }
});

test('mocked Worker: all 15 scopes succeed on each of the three POST operations', async () => {
  const h = harness();
  for (const roleId of roles) for (const profileId of profiles) {
    for (const operation of Object.keys(operations)) {
      const response = await h.request(operation, {roleId, profileId}, `?role=${roleId}`);
      assert.equal(response.status, 200, `${operation}: ${roleId}/${profileId}`);
      const result = await response.json();
      assert.equal(result.roleId, roleId);
      assert.equal(result.profileId, profileId);
      if (operation === 'save-note') assert.equal(result.saved, true);
    }
  }
  assert.equal(h.calls.length, 60, 'libraries/search call once, save-note calls twice');
});

test('mocked Worker: invalid/missing enums and extra fields fail before upstream access', async () => {
  const h = harness();
  for (const operation of Object.keys(operations)) {
    for (const field of ['roleId', 'profileId']) {
      for (const value of [undefined, null, '', 'unknown', field === 'roleId' ? 'Bear' : 'Mobile', []]) {
        const response = await h.request(operation, {roleId: 'bear', profileId: 'mobile', [field]: value});
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, 'invalid_ima_scope');
      }
    }
    const response = await h.request(operation, {roleId: 'bear', profileId: 'mobile'}, '', {unexpected: true});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_ima_scope');
  }
  assert.equal(h.calls.length, 0);
});

test('mocked Worker: omitted role query is allowed; mismatched/duplicate queries are rejected', async () => {
  for (const operation of Object.keys(operations)) {
    const h = harness();
    for (const query of ['?role=apple', '?role=bear&role=bear']) {
      const response = await h.request(operation, {roleId: 'bear', profileId: 'mobile'}, query);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'role_mismatch');
    }
    assert.equal(h.calls.length, 0);
    assert.equal((await h.request(operation, {roleId: 'bear', profileId: 'mobile'})).status, 200);
  }
});

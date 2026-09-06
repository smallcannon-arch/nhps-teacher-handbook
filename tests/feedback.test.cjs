const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
const ORIGIN = 'https://smallcannon-arch.github.io';

function fixture(options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../cloudflare/migrations/0001_feedback.sql'), 'utf8'));
  const calls = [];
  const env = {
    GAS_URL: 'https://example.invalid/api',
    REPORT_RATE_LIMITER: { limit: async () => ({ success: options.quota !== false }) },
    REPORTS_DB: { prepare(sql) {
      return { bind(...args) {
        return {
          first: async () => db.prepare(sql).get(...args) || null,
          all: async () => ({ results: db.prepare(sql).all(...args) }),
          run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } })
        };
      } };
    } }
  };
  const context = vm.createContext({ Request, Response, URL, AbortSignal, TextDecoder, Uint8Array,
    fetch: async (url, init) => {
      calls.push(init.method);
      if (options.upstreamFailure) throw new Error('sensitive upstream failure');
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        assert.equal(body.cmd, 'directoryList');
        return Response.json(body.idToken === 'invalid' ? { ok: false, error: 'private upstream error' }
          : { ok: true, user: { role: options.role || 'editor' } });
      }
      return Response.json({ ok: true, resources: [{ id: 'card-a', title: '正式資料卡', office: '教務處',
        visible: !options.hidden, links: [{ label: '表單', url: 'https://example.com/form' }] }] });
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../cloudflare/feedback.js'), 'utf8').replace('export async function', 'async function'), context);
  const send = async (endpoint, body, { origin = ORIGIN, method = 'POST', raw } = {}) => {
    const request = new Request('https://example.invalid/reports/' + endpoint, {
      method, headers: { Origin: origin, 'Content-Type': 'text/plain' },
      ...(method === 'POST' ? { body: raw === undefined ? JSON.stringify(body) : raw } : {})
    });
    const response = await context.handleReports(request, env);
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
  const draft = () => ({ id: webcrypto.randomUUID(), resourceId: 'card-a', issue: '連結無法開啟', detail: '無法開啟測試' });
  return { db, env, calls, send, draft };
}

test('public endpoint never exposes the inbox, and origin is restricted', async () => {
  const f = fixture();
  assert.equal((await f.send('admin', {}, { method: 'GET' })).status, 405);
  assert.equal((await f.send('admin', { action: 'list' })).status, 401);
  assert.equal((await f.send('submit', f.draft(), { origin: 'https://foreign.invalid' })).status, 403);
  assert.equal(f.calls.length, 0);
  const preflight = await f.send('admin', {}, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  f.db.close();
});

test('submission stores authoritative resource fields and is idempotent on retry', async () => {
  const f = fixture(); const body = { ...f.draft(), title: 'forged', office: 'forged' };
  assert.equal((await f.send('submit', body)).status, 200);
  assert.equal((await f.send('submit', body)).status, 200);
  const rows = f.db.prepare('SELECT * FROM feedback_reports').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].title, '正式資料卡'); assert.equal(rows[0].status, '待處理');
  assert.equal(f.calls.length, 1);
  assert.equal((await f.send('submit', { ...body, detail: 'changed' })).status, 409);
  f.db.close();
});

test('hidden and unknown cards cannot be reported', async () => {
  const f = fixture({ hidden: true });
  assert.equal((await f.send('submit', f.draft())).status, 404);
  assert.equal((await f.send('submit', { ...f.draft(), resourceId: 'missing' })).status, 404);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM feedback_reports').get().n, 0);
  f.db.close();
});

test('malformed, oversized, invalid option and honeypot submissions are rejected', async () => {
  const f = fixture();
  for (const body of [{ ...f.draft(), detail: 'x'.repeat(501) }, { ...f.draft(), issue: 'invalid' }, { ...f.draft(), website: 'spam' }, { ...f.draft(), id: 'bad' }]) {
    assert.equal((await f.send('submit', body)).status, 400);
  }
  assert.equal((await f.send('submit', {}, { raw: '{' })).status, 400);
  assert.equal((await f.send('submit', {}, { raw: 'x'.repeat(8193) })).status, 413);
  assert.equal(f.calls.length, 0);
  f.db.close();
});

test('rate limited requests do not call upstream or insert reports', async () => {
  const f = fixture({ quota: false });
  assert.equal((await f.send('submit', f.draft())).status, 429);
  assert.equal(f.calls.length, 0); f.db.close();
});

test('invalid token and viewer role cannot read or update even with forged client role', async () => {
  const f = fixture({ role: 'viewer' });
  assert.equal((await f.send('admin', { action: 'list', idToken: 'invalid' })).status, 401);
  assert.equal((await f.send('admin', { action: 'list', idToken: 'fixture-token', role: 'admin' })).status, 403);
  assert.equal((await f.send('admin', { action: 'update', idToken: 'fixture-token', role: 'admin' })).status, 403);
  f.db.close();
});

test('authorized list paginates without losing rows and filters statuses', async () => {
  const f = fixture(); const draft = f.draft(); await f.send('submit', draft);
  const row = f.db.prepare('SELECT * FROM feedback_reports').get();
  const insert = f.db.prepare('INSERT INTO feedback_reports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 52; i++) insert.run(webcrypto.randomUUID(), row.resource_id, row.title, row.office, row.links_json, row.issue, row.detail, i === 0 ? '已完成' : '待處理', row.created_at, row.updated_at, 1);
  const a = await f.send('admin', { action: 'list', idToken: 'fixture-token', status: '待處理' });
  assert.equal(a.data.items.length, 50); assert.ok(a.data.next);
  const b = await f.send('admin', { action: 'list', idToken: 'fixture-token', status: '待處理', before: a.data.next });
  assert.equal(b.data.items.length, 2); assert.equal(b.data.next, null);
  assert.equal(new Set([...a.data.items, ...b.data.items].map(x => x.id)).size, 52);
  assert.equal((await f.send('admin', { action: 'list', idToken: 'fixture-token', before: -1 })).status, 400);
  f.db.close();
});

test('status updates reject concurrent stale versions and revalidate permission each time', async () => {
  const f = fixture(); const draft = f.draft(); await f.send('submit', draft);
  const change = { action: 'update', idToken: 'fixture-token', id: draft.id, version: 1, status: '處理中' };
  const result = await f.send('admin', change); assert.equal(result.status, 200); assert.equal(result.data.item.version, 2);
  assert.equal((await f.send('admin', { ...change, status: '已完成' })).status, 409);
  assert.equal(f.db.prepare('SELECT status FROM feedback_reports').get().status, '處理中');
  assert.equal(f.calls.filter(x => x === 'POST').length, 2); f.db.close();
});

test('service errors never expose upstream details', async () => {
  const f = fixture({ upstreamFailure: true });
  const result = await f.send('submit', f.draft());
  assert.equal(result.status, 503); assert.ok(!JSON.stringify(result.data).includes('sensitive'));
  f.db.close();
});

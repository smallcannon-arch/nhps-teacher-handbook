const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture() {
  const headers = ['time', 'email', 'action', 'target', 'result', 'message'];
  const logs = [headers];
  for (let i = 0; i < 205; i++) logs.push(['2026-09-07 10:00:00', 'teacher@example.test', 'saveDirectoryResource', 'r1,missing', 'ok', 'private error details']);
  logs.push(['2026-09-08 10:00:00', 'other@example.test', 'directoryList', '', 'ok', 'load']);
  const tables = { users: [{email: 'teacher@example.test', name: '測試教師'}], resources: [{resource_id: 'r1', title: '<script>文字</script>'}], shortcuts: [], chapters: [] };
  let reads = 0;
  const c = vm.createContext({ Date, APP: {SHEETS: {USERS: 'users', DIRECTORY_RESOURCES: 'resources', DIRECTORY_SHORTCUTS: 'shortcuts', CHAPTERS: 'chapters', LOGS: 'logs'}},
    readTable: name => { reads++; return tables[name]; }, getSheet: () => { reads++; return {getDataRange: () => ({getValues: () => logs})}; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/10_EditLogs.gs'), 'utf8'), c);
  return { c, logs, reads: () => reads, list: payload => c.getEditLogs_(payload || {}, {role:'admin'}) };
}
test('non-admins cannot read any backing tables', () => {
  const f = fixture();
  for (const role of ['viewer', 'editor', 'reviewer', undefined]) assert.throws(() => f.c.getEditLogs_({}, {role}), /僅管理員/);
  assert.equal(f.reads(), 0);
});
test('pagination is complete, excludes views, and is stable with new appended logs', () => {
  const f = fixture(); const a = f.list();
  f.logs.push(['2026-09-08 10:00:00', 'teacher@example.test', 'saveDraft', '', 'ok', '']);
  const b = f.list({before: a.next}), c = f.list({before: b.next});
  const all = [...a.items, ...b.items, ...c.items];
  assert.equal(a.items.length, 100); assert.equal(b.items.length, 100); assert.equal(c.items.length, 5);
  assert.equal(new Set(all.map(r => r.row)).size, 205); assert.equal(c.next, null);
  assert.equal(all[0].target, '<script>文字</script>（r1）、missing');
  assert.equal(JSON.stringify(all).includes('private error details'), false);
});
test('account/name and inclusive date filters with invalid range rejection', () => {
  const f = fixture();
  assert.equal(f.list({account:'測試',from:'2026-09-07',to:'2026-09-07'}).items.length, 100);
  assert.equal(f.list({account:'TEACHER@EXAMPLE.TEST'}).items.length, 100);
  assert.equal(f.list({from:'2026-09-08'}).items.length, 0);
  assert.equal(f.list({account:'absent'}).items.length, 0);
  assert.throws(() => f.list({from:'2026-02-30'}), /日期/);
  assert.throws(() => f.list({from:'2026-09-08',to:'2026-09-07'}), /日期/);
  assert.throws(() => f.list({before:-1}), /分頁/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const domain = 'school.example.test';
const mail = name => name + '@' + domain;
const headers = ['email', 'name', 'role', 'office', 'enabled', 'updated_at', 'custom'];

function fixture() {
  let rows = [headers, [mail('manager'), '管理員', 'admin', '總務處', 'TRUE', 'before', 'keep'],
    ['', '', '', '', '', '', ''], [mail('teacher'), '教師', 'editor', '教務處', 'TRUE', 'before', 'preserve']];
  const events = [];
  let profile = 'manager';
  let onLock = () => {};
  const sheet = { getDataRange: () => ({ getValues: () => rows.map(r => [...r]) }) };
  const objects = () => rows.slice(1).filter(r => r[0]).map((row, i) => Object.fromEntries(headers.map((h, index) => [h, row[index]])));
  const context = vm.createContext({ Date, APP: { SHEETS: { USERS: 'Users' }, USER_COLUMNS: headers.slice(0, 6),
    ALLOWED_EMAIL_DOMAIN: domain, AUTO_ALLOW_DOMAIN_USERS: true, DEFAULT_DOMAIN_ROLE: 'editor' },
    getSheet: () => sheet, readTable: objects,
    writeRowByHeaders: (name, rowIndex, item) => { rows[rowIndex - 1] = headers.map(h => item[h] ?? ''); events.push('write'); },
    appendRowByHeaders: (name, item) => { rows.push(headers.map(h => item[h] ?? '')); events.push('append'); },
    nowText: () => 'same-second', logAction: (...args) => { assert.equal(args[0], ''); events.push('audit'); },
    LockService: { getScriptLock: () => ({ tryLock: () => { events.push('lock'); onLock(); return true; }, releaseLock: () => events.push('release') }) },
    SpreadsheetApp: { flush: () => events.push('flush') }
  });
  for (const name of ['05_Auth.gs', '09_Users.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas', name), 'utf8'), context);
  context.verifyGoogleIdToken_ = () => ({ email: mail(profile), hd: domain });
  const actor = { email: mail('manager'), role: 'admin' };
  const listed = name => context.getManagedAccounts_(actor).users.find(u => u.email === mail(name));
  const update = (name, patch) => {
    const original = listed(name);
    return context.saveManagedAccount_({ create: false, revision: original.revision, account: { ...original, ...patch } }, actor);
  };
  return { context, actor, rows: () => rows, events, listed, update,
    profile: name => { profile = name; }, onLock: fn => { onLock = fn; } };
}

test('only verified admins can list or save accounts', () => {
  const f = fixture();
  for (const role of ['viewer', 'editor', 'reviewer']) {
    assert.throws(() => f.context.getManagedAccounts_({ role }), /僅管理員/);
    assert.throws(() => f.context.saveManagedAccount_({}, { role }), /僅管理員/);
  }
  assert.equal(f.events.length, 0);
});

test('blank sheet rows do not shift updates and unknown columns are retained', () => {
  const f = fixture(); const result = f.update('teacher', { office: '學務處', name: '新姓名' });
  assert.equal(f.rows()[2][0], ''); assert.equal(f.rows()[3][3], '學務處'); assert.equal(f.rows()[3][6], 'preserve');
  assert.equal(result.user.revision, f.listed('teacher').revision);
  assert.ok(f.events.indexOf('flush') < f.events.indexOf('release'));
});

test('disabled named school user cannot fall back to auto-approved editor', () => {
  const f = fixture(); f.update('teacher', { enabled: false }); f.profile('teacher');
  assert.throws(() => f.context.requireUser_('fixture-token'), /已停用/);
  f.profile('new-school-user'); assert.equal(f.context.requireUser_('fixture-token').role, 'editor');
});

test('reenabled user receives explicit role and office', () => {
  const f = fixture(); f.update('teacher', { enabled: false }); f.update('teacher', { enabled: true, role: 'viewer' }); f.profile('teacher');
  const user = f.context.requireUser_('fixture-token'); assert.equal(user.role, 'viewer'); assert.equal(user.office, '教務處');
});

test('last enabled administrator cannot be disabled or demoted', () => {
  const f = fixture();
  assert.throws(() => f.update('manager', { enabled: false }), /最後一位/);
  assert.throws(() => f.update('manager', { role: 'editor' }), /最後一位/);
  assert.equal(f.rows()[1][2], 'admin'); assert.equal(f.rows()[1][4], 'TRUE');
});

test('self privilege reduction is blocked even with another admin', () => {
  const f = fixture(); f.update('teacher', { role: 'admin' });
  assert.throws(() => f.update('manager', { enabled: false }), /不能在此變更自己/);
  f.update('teacher', { enabled: false }); assert.equal(f.rows()[3][4], 'FALSE');
});

test('recheck actor inside lock rejects revoked administrator', () => {
  const f = fixture(); f.onLock(() => { f.rows()[1][2] = 'editor'; });
  assert.throws(() => f.update('teacher', { enabled: false }), /管理權限已變更/);
  assert.equal(f.rows()[3][4], 'TRUE'); assert.equal(f.events.at(-1), 'release');
});

test('stale saves are rejected even within a single timestamp second', () => {
  const f = fixture(); f.update('teacher', { name: '第一次' }); const stale = f.listed('teacher');
  f.update('teacher', { name: '第二次' });
  assert.throws(() => f.context.saveManagedAccount_({ create: false, revision: stale.revision, account: { ...stale, name: '舊資料' } }, f.actor), /資料已變更/);
  assert.equal(f.listed('teacher').name, '第二次');
});

test('new named account is normalized and duplicate create is rejected', () => {
  const f = fixture(); const account = { email: '  ' + mail('NEW').toUpperCase() + '  ', name: '新增教師', role: 'viewer', office: '教務處', enabled: false };
  const created = f.context.saveManagedAccount_({ create: true, account }, f.actor);
  assert.equal(created.user.email, mail('new')); assert.equal(created.user.enabled, false);
  assert.throws(() => f.context.saveManagedAccount_({ create: true, account }, f.actor), /已存在/);
});

test('invalid domain, role, formula and string boolean cannot be saved', () => {
  const f = fixture();
  for (const patch of [{ email: 'outsider@other.example.test' }, { role: 'owner' }, { name: '=IMPORTXML()' }, { office: '+formula' }, { enabled: 'TRUE' }]) {
    assert.throws(() => f.update('teacher', patch));
  }
  assert.equal(f.events.length, 0);
});

test('duplicate account mutation is refused without overwriting any row', () => {
  const f = fixture(); f.rows().push([...f.rows()[3]]);
  assert.throws(() => f.update('teacher', { enabled: false }), /重複設定/);
  assert.ok(!f.events.includes('write'));
});

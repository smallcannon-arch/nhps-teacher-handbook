const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8').replace('export default', 'const worker ='), context);
const resources = Array.from({ length: 5 }, (_, i) => ({
  title: `行事曆 ${i}`, office: '校長室', summary: '不應出現在精簡回覆的冗長摘要',
  sort_order: i, links: [{ url: `https://example.com/calendar?src=${'a'.repeat(300)}&id=${i}` }]
}));

test('query returns at most three ranked resources and excludes hidden resources', () => {
  const results = context.searchLineDirectory('行事曆', [{ ...resources[0], visible: false }, ...resources]);
  assert.equal(results.length, 3);
  assert.deepEqual(Array.from(results, item => item.resource.title), ['行事曆 0', '行事曆 1', '行事曆 2']);
});

test('cards preserve full destination URLs while hiding URLs and summaries from visible text', () => {
  const message = context.createLineSearchResultsMessage('行事曆', resources.map(resource => ({ resource, link: resource.links[0] })));
  assert.equal(message.type, 'flex');
  const blocks = message.contents.body.contents.filter(item => item.type === 'box');
  assert.equal(blocks.length, 3);
  blocks.forEach((block, i) => {
    assert.equal(block.contents[2].action.uri, resources[i].links[0].url);
    assert.equal(block.contents[2].action.label, '開啟');
  });
  const texts = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.text) texts.push(value.text);
    Object.values(value).forEach(walk);
  }
  walk(message);
  assert.ok(!texts.join('').includes('https://'));
  assert.ok(!texts.join('').includes(resources[0].summary));
  assert.ok(message.altText.includes('行事曆 0'));
  assert.ok(message.quickReply.items.length <= 13);
  assert.equal(message.contents.footer.contents[0].action.uri, 'https://smallcannon-arch.github.io/nhps-teacher-handbook/');
});

test('fallback keeps handbook action without a raw URL and unicode truncation is safe', () => {
  const message = context.createLineNoResultsMessage('不存在');
  assert.ok(!message.text.includes('https://'));
  assert.equal(message.quickReply.items[0].action.type, 'uri');
  assert.equal(context.truncateLineText('😀😀😀', 2), '😀…');
});

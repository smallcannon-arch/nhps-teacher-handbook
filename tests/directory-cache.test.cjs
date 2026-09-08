const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../cloudflare/worker.js'), 'utf8')
  .replace(/^import .*;$/mg, '').replace('export default', 'const worker =');
const env = {GAS_URL: 'https://example.test/gas'};
const request = new Request('https://worker.test/?action=getDirectory');
function fixture(store, clock) {
  let fetches = 0;
  const pending = [];
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() {return clock.now;} }
  const c = vm.createContext({Request, Response, Headers, URL, Date: ClockDate,
    caches: {default: {
      match: async key => store.get(key.url)?.clone(),
      put: async (key, value) => {store.set(key.url, value.clone());}
    }}, fetch: async () => {fetches++; return Response.json({ok:true, cache_version:'v2'});}
  });
  vm.runInContext(source, c);
  return {read:()=>c.getCacheVersion(env,request,{waitUntil:p=>pending.push(p)}),
    browser:(response,action='getDirectory',cacheable=true)=>c.directoryBrowserCache(response,action,cacheable),
    flush:()=>Promise.all(pending), fetches:()=>fetches};
}
test('a fresh isolate reuses edge version without another Google request', async()=>{
  const store=new Map(),clock={now:100000};
  const first=fixture(store,clock); assert.equal((await first.read()).source,'gas'); await first.flush();
  const second=fixture(store,clock); assert.equal((await second.read()).source,'edge-cache');
  assert.equal(second.fetches(),0);
  clock.now+=29000; assert.equal((await second.read()).source,'memory-cache');
  clock.now+=1001; assert.equal((await second.read()).source,'gas');
  assert.equal(second.fetches(),1);
});
test('browser caching never extends the original version deadline',async()=>{
  const clock={now:100000},f=fixture(new Map(),clock);
  await f.read(); await f.flush();
  clock.now+=24000;
  const result=f.browser(Response.json({ok:true}));
  assert.equal(result.headers.get('Cache-Control'),'private, max-age=6, must-revalidate');
  assert.equal(result.headers.get('Date'),new Date(clock.now).toUTCString());
  clock.now+=6001;
  assert.equal(f.browser(Response.json({ok:true})).headers.get('Cache-Control'),'no-store');
});
test('failed responses and other endpoints do not gain browser caching',async()=>{
  const f=fixture(new Map(),{now:100000}); await f.read(); await f.flush();
  assert.equal(f.browser(Response.json({ok:false}),'getDirectory',false).headers.get('Cache-Control'),'no-store');
  const health=Response.json({ok:true}); assert.equal(f.browser(health,'health'),health);
});
test('expired and malformed shared entries are refreshed',async()=>{
  for(const entry of [{value:'old',checkedAt:1},{value:'bad',checkedAt:'100000'},{}]){
    const key='https://worker.test/__handbook-version?upstream='+encodeURIComponent(env.GAS_URL);
    const f=fixture(new Map([[key,Response.json(entry)]]),{now:100000});
    assert.equal((await f.read()).value,'v2'); assert.equal(f.fetches(),1); await f.flush();
  }
});

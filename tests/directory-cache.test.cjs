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
  const c = vm.createContext({Request, Response, URL, Date: {now:()=>clock.now},
    caches: {default: {
      match: async key => store.get(key.url)?.clone(),
      put: async (key, value) => {store.set(key.url, value.clone());}
    }}, fetch: async () => {fetches++; return Response.json({ok:true, cache_version:'v2'});}
  });
  vm.runInContext(source, c);
  return {read:()=>c.getCacheVersion(env,request,{waitUntil:p=>pending.push(p)}),
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
test('expired and malformed shared entries are refreshed',async()=>{
  for(const entry of [{value:'old',checkedAt:1},{value:'bad',checkedAt:'100000'},{}]){
    const key='https://worker.test/__handbook-version?upstream='+encodeURIComponent(env.GAS_URL);
    const f=fixture(new Map([[key,Response.json(entry)]]),{now:100000});
    assert.equal((await f.read()).value,'v2'); assert.equal(f.fetches(),1); await f.flush();
  }
});

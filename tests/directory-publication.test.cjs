const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture(options={}) {
  const db=new DatabaseSync(':memory:');
  db.exec(read('cloudflare/migrations/0002_directory_publication.sql'));
  let reads=0;
  const env={GAS_URL:'https://source.test/exec',REPORTS_DB:{prepare(sql){return {
    bind(...args){return {run:async()=>{db.prepare(sql).run(...args);return {success:true};}};},
    first:async()=>db.prepare(sql).get()
  };}}};
  const data={ok:true,cache_version:100,resources:[{id:'yes',title:'公開',visible:true,links:[],internal:'omit'},
    {id:'hidden',visible:false},{id:'trash',visible:true,trash:true}],shortcuts:{all:[{label:'yes',enabled:true},{label:'no',enabled:false}]},user:{email:'private@example.test'}};
  const fetch=async(url,init={})=>{
    reads++;
    if(init.method==='POST') {
      const p=JSON.parse(init.body.startsWith('payload=')?new URLSearchParams(init.body).get('payload'):init.body);
      if(p.cmd==='directoryList') return Response.json({ok:true,user:{role:options.role||'admin'},cache_version:100});
      return Response.json(options.denied?{ok:false,error:'denied'}:{ok:true,resource_id:'yes',cache_version:100});
    }
    if(options.offline) throw Error('offline');
    return Response.json(new URL(url).searchParams.get('action')==='getConfig'
      ? {ok:true,cache_version:options.changed?101:100}:data);
  };
  const c=vm.createContext({fetch,Request,Response,Headers,URL,URLSearchParams,AbortController,setTimeout,clearTimeout});
  vm.runInContext(read('cloudflare/directory-publication.js').replace(/^export /mg,''),c);
  vm.runInContext(read('cloudflare/worker.js').replace(/^import .*;$/mg,'').replace('export default','const worker ='),c);
  c.env=env;
  return {db,c,data,reads:()=>reads,publish:()=>c.publishDirectory(env),
    call:async cmd=>c.proxyPostToGas(new Request('https://worker.test',{method:'POST',body:'payload='+encodeURIComponent(JSON.stringify({cmd,idToken:'test-only'}))}),env)};
}
test('publish uses public allowlist and removes hidden/trash/private metadata',async()=>{
  const f=fixture(); assert.equal((await f.publish()).status,'published');
  const body=JSON.parse(f.db.prepare('SELECT body FROM directory_publication').get().body);
  assert.deepEqual(body.resources.map(r=>r.id),['yes']); assert.equal(body.user,undefined);
  assert.equal(body.resources[0].internal,undefined); assert.equal(body.shortcuts.all.length,1);
});
test('snapshot GET does not call Google after initial publication',async()=>{
  const f=fixture();await f.publish();const before=f.reads();
  f.c.req=new Request('https://worker.test/?action=getDirectory');
  const result=await vm.runInContext('worker.fetch(req,env,{})',f.c);
  assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store');
  assert.equal(f.reads(),before);
});
test('actual SQL prevents older versions and older simultaneous reads overwriting newer ones',async()=>{
  const f=fixture();const sql=vm.runInContext('PUBLISH_SQL',f.c);
  for(const [version,start,body] of [[200,20,'new'],[100,30,'old'],[200,10,'older read']])
    f.db.prepare(sql).run(version,start,start,body);
  assert.equal(f.db.prepare('SELECT body FROM directory_publication').get().body,'new');
  f.db.prepare(sql).run(200,30,30,'manual sync');
  assert.equal(f.db.prepare('SELECT body FROM directory_publication').get().body,'manual sync');
});
test('changed source or failed publication leaves previous snapshot intact',async()=>{
  for(const opt of [{changed:true},{offline:true}]) {
    const f=fixture(opt);f.db.prepare('INSERT INTO directory_publication VALUES(1,1,1,1,?)').run('previous');
    assert.equal((await f.publish()).status,'pending');
    assert.equal(f.db.prepare('SELECT body FROM directory_publication').get().body,'previous');
  }
});
test('successful form-encoded save automatically publishes; denied save cannot publish',async()=>{
  const good=fixture();assert.equal((await (await good.call('saveDirectoryResource')).json()).publication.status,'published');
  const denied=fixture({denied:true});assert.equal((await (await denied.call('saveDirectoryResource')).json()).ok,false);
  assert.equal(denied.db.prepare('SELECT count(*) AS n FROM directory_publication').get().n,0);
});
test('manual sync requires server-confirmed publisher role and never returns the admin list',async()=>{
  const allowed=fixture();const data=await (await allowed.call('publishDirectory')).json();
  assert.equal(data.publication.status,'published');assert.equal(data.user,undefined);assert.equal(data.resources,undefined);
  const denied=fixture({role:'viewer'});assert.equal((await (await denied.call('publishDirectory')).json()).ok,false);
  assert.equal(denied.db.prepare('SELECT count(*) AS n FROM directory_publication').get().n,0);
});
test('saving still succeeds if publication fails so editors can retry without duplicating saves',async()=>{
  const f=fixture({offline:true});const data=await (await f.call('saveDirectoryResource')).json();
  assert.equal(data.ok,true);assert.equal(data.publication.status,'pending');
});

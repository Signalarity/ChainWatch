import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,cpSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../local/database.mjs';
import {createMonitor} from '../lib/monitor-core.ts';
import {exportSnapshot} from '../local/export.mjs';
import {createSnapshotClient} from '../lib/snapshot-client.mjs';
import {filterObservations,ranked,isSplit} from '../local/public-data.mjs';
import {publish,git} from '../local/publish.mjs';
import {START} from '../lib/evidence.mjs';
const owner='1BoatSLRHtKNngkdXEeobR76b53LETtpyT',id=n=>n.toString(16).padStart(64,'0');
function address(n){const a='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let value=n+1,s='';do{s=a[value%58]+s;value=Math.floor(value/58)}while(value);return '1'+s.padStart(32,'1')}
function fixture(){const root=mkdtempSync(join(tmpdir(),'chainwatch-local-')),db=openDatabase(join(root,'private.sqlite'));db.sqlite.exec("INSERT INTO meta(key,value) VALUES ('seeded','yes')");return {root,db,monitor:createMonitor(db.d1)}}
function record(status='btc_only',n=1){return {outpoint:id(n)+':0',address:owner,entity:'Test institution',value:100000*n,btc_tx:status==='xbt_only'||status==='protected'?null:id(100+n),xbt_tx:status==='btc_only'?null:status==='replayed'?id(100+n):id(200+n),status,time:START+100,btc_time:START+100,xbt_time:status==='btc_only'?null:START+100,btc_confs:12,xbt_confs:12,inscription:0,signature_signal:0,detail:'Observed split at last check.',checked:START+200,category:'Exchange',confidence:'Public registry',source_url:'https://example.org/attribution'}}
async function add(monitor,rows){await monitor.ingest(rows.map(r=>({address:r.address||owner,entity:r.entity||'Test institution',label:r.label||r.entity||'Test institution',category:r.category||'Exchange',source:'Public registry',source_url:'https://example.org/attribution',confidence:'Public registry',last_updated:'2026-10-01'})))}
function insert(db,r){const keys=['outpoint','address','entity','value','btc_tx','xbt_tx','status','time','btc_time','xbt_time','btc_confs','xbt_confs','inscription','signature_signal','detail','checked'];db.sqlite.prepare(`INSERT INTO observations(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>r[k]??null))}
function fakeFiles(root){const calls=[];return {calls,fetcher:async input=>{const url=new URL(input);calls.push(url.pathname);try{return new Response(readFileSync(join(root,url.pathname.replace('/chainwatch/',''))),{status:200,headers:{'content-type':'application/json'}})}catch{return new Response('not found',{status:404})}}}}
test('one-sided BTC movement counts as a split; replayed and pending transactions are excluded',()=>{const rows=[record('btc_only',1),record('xbt_only',2),record('protected',3),record('split',4),record('replayed',5),record('pending',6)];assert.equal(filterObservations(rows,new URLSearchParams()).length,4);assert.equal(ranked(rows).length,4);assert.equal(ranked(rows).at(-1).status,'btc_only');assert.equal(isSplit({...record(),btc_confs:0}),false)});
test('SQLite state and history cursors survive closing and reopening',async()=>{const f=fixture();await add(f.monitor,[{address:owner}]);f.db.sqlite.prepare("INSERT INTO jobs(id,address,chain,cursor,offset) VALUES (?,?,?,'saved-cursor',7)").run(owner+':btc',owner,'btc');f.db.close();const again=openDatabase(join(f.root,'private.sqlite'));assert.equal(again.sqlite.prepare('SELECT cursor,offset FROM jobs').get().cursor,'saved-cursor');assert.equal(again.sqlite.prepare('SELECT offset FROM jobs').get().offset,7);again.close()});
test('public export excludes replayed results, private fields and sensitive diagnostics',async()=>{const f=fixture();await add(f.monitor,[{address:owner}]);insert(f.db,record());insert(f.db,record('replayed',2));f.db.sqlite.exec("ALTER TABLE observations ADD private_notes TEXT; UPDATE observations SET private_notes='PRIVATE_DATABASE_CANARY'; INSERT INTO meta(key,value) VALUES ('rpc_cookie','PRIVATE_COOKIE_CANARY'); INSERT INTO meta(key,value) VALUES ('last_error','/home/hayden/private/password PRIVATE_ERROR_CANARY')");const out=join(f.root,'site'),m=exportSnapshot(f.db.sqlite,out),event=JSON.parse(readFileSync(join(out,m.resultPath,m.eventFiles[0]),'utf8'));assert.equal(event.length,1);assert.equal(event[0].status,'btc_only');const payload=JSON.stringify(m)+JSON.stringify(event);for(const marker of ['PRIVATE_DATABASE_CANARY','PRIVATE_COOKIE_CANARY','PRIVATE_ERROR_CANARY','/home/hayden'])assert.ok(!payload.includes(marker));assert.equal(m.coverage.addresses,1);f.db.close()});
test('browser queries use published files under a GitHub project subpath, including address search',async()=>{const f=fixture();await add(f.monitor,[{address:owner,entity:'US Government custody',category:'Government custody',label:'Publicly attributed seized funds'},{address:address(10),entity:'Example Exchange'}]);insert(f.db,{...record(),entity:'US Government custody'});const out=join(f.root,'site');exportSnapshot(f.db.sqlite,out);const io=fakeFiles(out),client=createSnapshotClient({baseUrl:'https://example.github.io/chainwatch/',fetcher:io.fetcher});const view=await client.dashboard(new URLSearchParams());assert.equal(view.events.length,1);assert.equal(view.top[0].status,'btc_only');const search=await client.addresses(new URLSearchParams({q:'Government'}));assert.equal(search.total,1);assert.equal(search.rows[0].entity,'US Government custody');const exact=await client.addresses(new URLSearchParams({q:owner}));assert.equal(exact.total,1);assert.equal(exact.rows[0].address,owner);assert.ok(io.calls.every(p=>p.startsWith('/chainwatch/data/')));f.db.close()});
test('large institution lists are paginated without loading the full catalog',async()=>{const f=fixture();await add(f.monitor,Array.from({length:601},(_,n)=>({address:address(n),entity:'Large Exchange'})));const out=join(f.root,'site');exportSnapshot(f.db.sqlite,out);const io=fakeFiles(out),client=createSnapshotClient({baseUrl:'https://example.github.io/chainwatch/',fetcher:io.fetcher});const first=await client.addresses(new URLSearchParams({q:'Large Exchange'}));const second=await client.addresses(new URLSearchParams({q:'Large Exchange',offset:'500'}));assert.equal(first.total,601);assert.equal(first.rows.length,50);assert.equal(second.rows.length,50);assert.ok(!first.rows.some(a=>second.rows.some(b=>a.address===b.address)));assert.equal(io.calls.filter(p=>p.includes('entity-')).length,2);f.db.close()});
test('a previous published generation remains available through an update',async()=>{const f=fixture();await add(f.monitor,[{address:owner}]);insert(f.db,record());const out=join(f.root,'site'),before=exportSnapshot(f.db.sqlite,out);insert(f.db,record('xbt_only',2));const after=exportSnapshot(f.db.sqlite,out);assert.notEqual(before.resultPath,after.resultPath);assert.ok(existsSync(join(out,before.resultPath,'events-0.json')));assert.equal(after.observationCount,2);f.db.close()});
test('replayed observations are purged during initialization rather than tracked',async()=>{const f=fixture();await add(f.monitor,[{address:owner}]);insert(f.db,record('replayed',8));await f.monitor.initialize();assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM observations').get().n,0);f.db.close()});
test('Git publication stages only public files and preserves unrelated repository paths',async()=>{const f=fixture();await add(f.monitor,[{address:owner}]);insert(f.db,record());const out=join(f.root,'site');exportSnapshot(f.db.sqlite,out);mkdirSync(join(out,'assets'));writeFileSync(join(out,'index.html'),'<h1>Public dashboard</h1>');writeFileSync(join(out,'assets/app.js'),'console.log("public")');writeFileSync(join(out,'.nojekyll'),'');writeFileSync(join(out,'config.local.json'),'PRIVATE_CONFIG_CANARY');writeFileSync(join(out,'data/secret.json'),'PRIVATE_DATA_CANARY');const remote=join(f.root,'remote.git');await git(['init','--bare','--quiet',remote],{cwd:f.root});const cfg={publishRepo:remote,publicationDir:join(f.root,'publication'),outputDir:out};const result=await publish(cfg);assert.equal(result.published,true);const paths=(await git(['--git-dir='+remote,'ls-tree','--name-only','-r','main'],{cwd:f.root})).split('\n');assert.ok(paths.includes('docs/index.html'));assert.ok(paths.includes('.github/workflows/chainwatch-pages.yml'));assert.match(await git(['--git-dir='+remote,'show','main:.github/workflows/chainwatch-pages.yml'],{cwd:f.root}),/path: docs/);assert.ok(paths.includes('source/local/run.mjs'));assert.ok(!paths.some(p=>p.includes('secret.json')||p.includes('config.local.json')||p.includes('.sqlite')||p.includes('known_hosts')));const prior=result.commit;const editor=join(f.root,'editor');await git(['clone','--quiet','--branch','main',remote,editor],{cwd:f.root});writeFileSync(join(editor,'NOTES.txt'),'Unrelated repository content');await git(['add','NOTES.txt'],{cwd:editor});await git(['-c','user.name=Test','-c','user.email=test@example.org','commit','--quiet','-m','Add unrelated content'],{cwd:editor});await git(['push','--quiet','origin','main'],{cwd:editor});const edited=await git(['rev-parse','HEAD'],{cwd:editor});writeFileSync(join(out,'index.html'),'<h1>Updated results</h1>');const next=await publish(cfg);assert.equal(await git(['--git-dir='+remote,'rev-parse',next.commit+'^'],{cwd:f.root}),edited);assert.equal(await git(['--git-dir='+remote,'show','main:docs/index.html'],{cwd:f.root}),'<h1>Updated results</h1>');assert.equal(await git(['--git-dir='+remote,'show','main:NOTES.txt'],{cwd:f.root}),'Unrelated repository content');f.db.close()});
test('a previously observed BTC split is removed when the same spend appears on XBT',async()=>{
 const f=fixture();await add(f.monitor,[{address:owner}]);insert(f.db,record('btc_only',1));
 const original=globalThis.fetch,requests=[];const {SHARED_HEIGHT,SHARED_HASH,FORK,FORK_HASH}=await import('../lib/evidence.mjs');
 globalThis.fetch=async input=>{const u=new URL(input),path=u.pathname.slice(4);requests.push(path);if(path==='/blocks/tip/height')return Response.json(1000000);if(path==='/block-height/'+SHARED_HEIGHT)return Response.json(SHARED_HASH);if(path==='/block-height/'+FORK)return Response.json(FORK_HASH);if(path==='/tx/'+id(1))return Response.json({txid:id(1),status:{confirmed:true,block_height:SHARED_HEIGHT-1,block_hash:'shared'},vout:[{value:100000,scriptpubkey:'0014abc',scriptpubkey_address:owner}]});if(path.includes('/outspend/'))return Response.json({spent:true,txid:id(101),status:{confirmed:true,block_height:999990,block_hash:'spend'}});if(path.includes('/address/'))return Response.json([]);throw Error('Unexpected request '+path)};
 try{await f.monitor.refresh(undefined,{minInterval:0,maxDuration:60000});assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM observations').get().n,0);assert.ok(!requests.includes('/tx/'+id(101)))}finally{globalThis.fetch=original;f.db.close()}
});
test('coin total uses every matching original output, beyond the 200-row feed and top ten',async()=>{
 const f=fixture();await add(f.monitor,[{address:owner,entity:'Alpha & Co'},{address:address(7),entity:'Alpha & Co Holdings'},{address:address(8),entity:'Beta Treasury',category:'Public organization'}]);
 for(let n=1;n<=250;n++)insert(f.db,{...record('btc_only',n),entity:'Alpha & Co'});
 insert(f.db,{...record('btc_only',251),address:address(7),entity:'Alpha & Co Holdings'});
 insert(f.db,{...record('xbt_only',252),address:address(8),entity:'Beta Treasury'});
 insert(f.db,{...record('replayed',253),entity:'Alpha & Co'});
 const out=join(f.root,'site');exportSnapshot(f.db.sqlite,out);const client=createSnapshotClient({baseUrl:'https://example.github.io/chainwatch/',fetcher:fakeFiles(out).fetcher});
 const all=await client.dashboard(new URLSearchParams());assert.equal(all.events.length,200);assert.equal(all.top.length,10);assert.equal(all.summary.totalSplitValue,252*253/2*100000);assert.deepEqual(all.institutions,['Alpha & Co','Alpha & Co Holdings','Beta Treasury']);
 const selected=await client.dashboard(new URLSearchParams({institution:'Alpha & Co'}));assert.equal(selected.summary.totalSplitValue,250*251/2*100000);assert.ok(selected.events.every(r=>r.entity==='Alpha & Co'));
 const xbt=await client.dashboard(new URLSearchParams({institution:'Beta Treasury',status:'xbt_only'}));assert.equal(xbt.summary.totalSplitValue,25200000);assert.equal(xbt.events.length,1);
 const empty=await client.dashboard(new URLSearchParams({institution:'Alpha & Co',start:'2026-09-02'}));assert.equal(empty.summary.totalSplitValue,0);
 f.db.close();
});
test('institution selection filters the address directory exactly and combines with search and category',async()=>{
 const f=fixture();await add(f.monitor,[{address:owner,entity:'Alpha & Co'},{address:address(9),entity:'Alpha & Co Holdings'},{address:address(10),entity:'Beta Treasury',category:'Public organization'}]);
 const out=join(f.root,'site');exportSnapshot(f.db.sqlite,out);const client=createSnapshotClient({baseUrl:'https://example.github.io/chainwatch/',fetcher:fakeFiles(out).fetcher});
 const selected=await client.addresses(new URLSearchParams({institution:'Alpha & Co'}));assert.equal(selected.total,1);assert.equal(selected.rows[0].address,owner);
 const combined=await client.addresses(new URLSearchParams({institution:'Alpha & Co',q:owner,category:'Exchange'}));assert.equal(combined.total,1);
 const excluded=await client.addresses(new URLSearchParams({institution:'Alpha & Co Holdings',q:owner}));assert.equal(excluded.total,0);
 const wrongCategory=await client.addresses(new URLSearchParams({institution:'Alpha & Co',category:'Public organization'}));assert.equal(wrongCategory.total,0);
 f.db.close();
});
test('institution groups contain all filtered observations, including those beyond the visible feed',async()=>{
 const f=fixture();await add(f.monitor,[{address:owner,entity:'Alpha Exchange'},{address:address(12),entity:'Beta Treasury'}]);
 for(let n=1;n<=251;n++)insert(f.db,{...record('btc_only',n),entity:'Alpha Exchange'});
 insert(f.db,{...record('xbt_only',252),address:address(12),entity:'Beta Treasury',checked:START+500,time:START+300});
 const out=join(f.root,'site');exportSnapshot(f.db.sqlite,out);const client=createSnapshotClient({baseUrl:'https://example.github.io/chainwatch/',fetcher:fakeFiles(out).fetcher});
 const all=await client.dashboard(new URLSearchParams());assert.equal(all.events.length,200);assert.equal(all.observationGroups.length,2);assert.equal(all.observationGroups[0].entity,'Beta Treasury');
 const alpha=all.observationGroups.find(g=>g.entity==='Alpha Exchange');assert.equal(alpha.count,251);assert.equal(alpha.records.length,251);assert.equal(alpha.addressCount,1);assert.equal(alpha.value,251*252/2*100000);assert.equal(all.observationGroups.reduce((n,g)=>n+g.value,0),all.summary.totalSplitValue);
 const selected=await client.dashboard(new URLSearchParams({institution:'Beta Treasury'}));assert.equal(selected.observationGroups.length,1);assert.equal(selected.observationGroups[0].count,1);assert.equal(selected.observationGroups[0].value,25200000);
 const empty=await client.dashboard(new URLSearchParams({status:'protected'}));assert.deepEqual(empty.observationGroups,[]);
 f.db.close();
});
test('Coinbase and Silk Road finish first, then fresh addresses retain their original order',async()=>{
 const f=fixture(),original=globalThis.fetch,seen=[];
 const {SHARED_HEIGHT,SHARED_HASH,FORK,FORK_HASH}=await import('../lib/evidence.mjs');
 const ordinary=[address(301),address(302)].sort(),coinbase=address(310),silk=address(311);
 await add(f.monitor,[{address:ordinary[1],entity:'Other B'},{address:silk,entity:'Silk Road'},{address:ordinary[0],entity:'Other A'},{address:coinbase,entity:'Coinbase'}]);
 globalThis.fetch=async input=>{const path=new URL(input).pathname.slice(4);
  if(path==='/blocks/tip/height')return Response.json(1000000);
  if(path==='/block-height/'+SHARED_HEIGHT)return Response.json(SHARED_HASH);
  if(path==='/block-height/'+FORK)return Response.json(FORK_HASH);
  if(path.startsWith('/address/')){seen.push(path.split('/')[2]);return Response.json([])}
  throw Error('Unexpected request '+path);
 };
 try{await f.monitor.refresh(undefined,{minInterval:0,maxDuration:60000,maxRequests:64});assert.deepEqual([...new Set(seen)],[coinbase,silk,...ordinary]);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM jobs WHERE done=0').get().n,0)}finally{globalThis.fetch=original;f.db.close()}
});
test('new Coinbase attribution gets its first scan before an existing unfinished Coinbase history',async()=>{
 const f=fixture(),original=globalThis.fetch,seen=[];
 const {SHARED_HEIGHT,SHARED_HASH,FORK,FORK_HASH}=await import('../lib/evidence.mjs');
 const active=address(410),fresh=address(411);
 await add(f.monitor,[{address:active,entity:'Coinbase'},{address:fresh,entity:'Coinbase'}]);
 f.db.sqlite.prepare('INSERT INTO jobs(id,address,chain,cursor) VALUES (?,?,?,?)').run(active+':btc',active,'btc','preserved-history-cursor');
 globalThis.fetch=async input=>{const path=new URL(input).pathname.slice(4);
  if(path==='/blocks/tip/height')return Response.json(1000000);
  if(path==='/block-height/'+SHARED_HEIGHT)return Response.json(SHARED_HASH);
  if(path==='/block-height/'+FORK)return Response.json(FORK_HASH);
  if(path.startsWith('/address/')){seen.push(path);return Response.json([])}
  throw Error('Unexpected request '+path);
 };
 try{await f.monitor.refresh(undefined,{minInterval:0,maxDuration:60000,maxRequests:64});assert.equal(seen[0].split('/')[2],fresh);assert.ok(seen.some(path=>path.includes(active)&&path.includes('preserved-history-cursor')))}finally{globalThis.fetch=original;f.db.close()}
});

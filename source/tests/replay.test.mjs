import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBtcReplay,assessReplay,replayFields,replaySummary,checkerProgress} from '../lib/replay.mjs';
import {createXbtValidator} from '../local/xbt-validation.mjs';
import {checkNextReplay} from '../local/replay-worker.mjs';
import {FORK_HASH,START} from '../lib/evidence.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../local/database.mjs';
import {exportSnapshot} from '../local/export.mjs';
const id=n=>n.toString(16).padStart(64,'0');
function fixture(){
 const output={value:100,scriptpubkey:'0014'+'11'.repeat(20)};
 const tx={txid:id(9),vin:[{txid:id(1),vout:0,prevout:output}],vout:[output]};
 const values=new Map([['/tx/'+tx.txid+'/hex','0100'],['/blocks/tip/height',100],['/block-height/50','funding'],['/block-height/70','conflict'],['/tx/'+id(1)+'/outspend/0',{spent:false}]]);
 const parents=new Map([[id(1),{status:{confirmed:true,block_height:50,block_hash:'funding'},vout:[output]}]]);
 const session={async get(chain,path){assert.ok(values.has(path),path);return values.get(path)},async tx(chain,key){return parents.get(key)||null}};
 return {tx,values,parents,session};
}
test('local node acceptance tests the exact BTC hex without needing input explorer lookups',async()=>{const f=fixture();const r=await assessBtcReplay(f.session,f.tx,{xbtTip:100,validate:async(hex,txid)=>{assert.equal(hex,'0100');assert.equal(txid,f.tx.txid);return {allowed:true}}});assert.equal(r.state,'node_accepted')});
test('missing XBT ancestor is a dependency, never permanent replay protection',async()=>{const f=fixture();f.parents.clear();const r=await assessBtcReplay(f.session,f.tx,{xbtTip:100});assert.equal(r.state,'missing_ancestor');assert.match(r.detail,/replaying ancestors could change/)});
test('a confirmed conflicting input is checked against its canonical block and spend body',async()=>{const f=fixture();f.values.set('/tx/'+id(1)+'/outspend/0',{spent:true,txid:id(3),status:{confirmed:true,block_height:70,block_hash:'conflict'}});f.parents.set(id(3),{status:{confirmed:true,block_hash:'conflict'},vin:[{txid:id(1),vout:0}]});const r=await assessBtcReplay(f.session,f.tx,{xbtTip:100});assert.equal(r.state,'input_conflict');assert.match(r.detail,/six confirmations/)});
test('unconfirmed input conflict is not a confirmed split',async()=>{const f=fixture();f.values.set('/tx/'+id(1)+'/outspend/0',{spent:true,txid:id(3),status:{confirmed:false}});assert.equal((await assessBtcReplay(f.session,f.tx,{xbtTip:100})).state,'input_pending')});
test('failure to fetch spending data never becomes unspent or replayable',async()=>{const f=fixture();f.values.set('/tx/'+id(1)+'/outspend/0',null);await assert.rejects(assessBtcReplay(f.session,f.tx,{xbtTip:100}),/unavailable/)});
test('finding every input unspent does not prove full transaction validity',async()=>{const f=fixture();assert.equal((await assessBtcReplay(f.session,f.tx,{xbtTip:100})).state,'inputs_available')});
test('output-size hints and node policy rejection are not permanent consensus protection',async()=>{const f=fixture();f.tx.vout=[{scriptpubkey:'6a'+'00'.repeat(83)}];const r=await assessBtcReplay(f.session,f.tx,{xbtTip:100,validate:async()=>({allowed:false,reason:'min relay fee not met'})});assert.equal(r.state,'node_rejected');assert.match(r.detail,/may be policy/);assert.match(r.detail,/83 bytes/)});
test('node acceptance wins over static size hints when active rules permit the spend',async()=>{const f=fixture();f.tx.vout=[{scriptpubkey:'6a'+'00'.repeat(83)}];assert.equal((await assessBtcReplay(f.session,f.tx,{xbtTip:100,validate:async()=>({allowed:true})})).state,'node_accepted')});
test('reorged parent data never establishes a conflicting-input assessment',async()=>{const f=fixture();f.values.set('/block-height/50','reorganized');await assert.rejects(assessBtcReplay(f.session,f.tx,{xbtTip:100}),/block changed/)});
test('XBT validator requires synchronized main chain and exact fork checkpoint; RPCs are read-only',async()=>{
 const calls=[];const validate=createXbtValidator({},async(method,...args)=>{calls.push(method);if(method==='getblockchaininfo')return {chain:'main',blocks:100,headers:100,initialblockdownload:false,difficulty_blake2b:1};if(method==='getblockhash')return FORK_HASH;assert.equal(method,'testmempoolaccept');assert.deepEqual(JSON.parse(args[0]),['0100']);return [{txid:id(9),allowed:true}]});
 assert.deepEqual(await validate('0100',id(9)),{allowed:true,reason:''});assert.deepEqual(calls,['getblockchaininfo','getblockhash','testmempoolaccept']);
 const wrong=createXbtValidator({},async(method)=>method==='getblockchaininfo'?{chain:'main',blocks:100,headers:100,difficulty_blake2b:1}:'wrong');assert.deepEqual(await wrong('0100',id(9)),{unavailable:true});
 const unsynced=createXbtValidator({},async()=>({chain:'main',blocks:99,headers:100,difficulty_blake2b:1}));assert.deepEqual(await unsynced('0100',id(9)),{unavailable:true});
});
test('legacy observations default to pending and confirmed split totals exclude one-sided coins',()=>{
 assert.equal(replayFields({status:'btc_only'}).replay_state,'not_checked');assert.equal(replayFields({status:'split',checked:100}).replay_state,'different_spends');
 const rows=[{status:'split',value:20},{status:'btc_only',value:100,replay_state:'node_accepted'},{status:'xbt_only',value:30}];assert.deepEqual(replaySummary(rows),{confirmedSplitValue:20,oneSidedValue:130,replayableValue:100,replayPending:1});
});
test('replay worker assessments persist and public export excludes private fields',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chainwatch-replay-')),db=openDatabase(join(root,'state.sqlite')),f=fixture();
 db.sqlite.prepare('INSERT INTO addresses(address,entity,label,category,source,source_url,confidence,updated) VALUES (?,?,?,?,?,?,?,?)').run('watch','Bitwise Bitcoin ETF (BITB)','BITB','ETF','issuer','https://example.org','Public registry','2026-11-20');
 db.sqlite.prepare('INSERT INTO observations(outpoint,address,entity,value,btc_tx,status,time,btc_confs,detail,checked) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(1)+':0','watch','Bitwise Bitcoin ETF (BITB)',100,id(9),'btc_only',START+100,10,'one-sided',START+200);
 const t={...f.tx,status:{confirmed:true,block_height:80,block_hash:'btc'}};
 const remote=async(chain,path)=>{if(path==='/tx/'+id(9))return t;if(path==='/block-height/80')return 'btc';if(path==='/blocks/tip/height')return 100;if(path==='/block-height/961640')return FORK_HASH;if(path==='/tx/'+id(9)+'/hex')return '0100';throw Error('Unexpected '+path)};
 const result=await checkNextReplay(db.sqlite,{remote,validate:async()=>({allowed:true}),limits:{minInterval:0},now:START+500});assert.equal(result.state,'node_accepted');assert.equal((await checkNextReplay(db.sqlite,{remote,now:START+501})).idle,true);
 const manifest=exportSnapshot(db.sqlite,join(root,'site'));const events=JSON.parse(readFileSync(join(root,'site',manifest.resultPath,manifest.eventFiles[0]),'utf8'));assert.equal(events[0].replay_state,'node_accepted');assert.equal(events[0].replay_checked,START+500);assert.ok(!JSON.stringify(events).includes('0100'));db.close();
});

test('XBT-only transactions check dependencies on BTC and do not imply full BTC validity',async()=>{
 const f=fixture(),calls=[];const session={async tx(chain,id){calls.push(chain);return f.session.tx(chain,id)},get:f.session.get};
 assert.equal((await assessReplay(session,f.tx,{source:'xbt',targetTip:100,sourceConfs:10})).state,'btc_inputs_available');assert.ok(calls.every(c=>c==='btc'));
 f.parents.clear();assert.equal((await assessReplay(session,f.tx,{source:'xbt',targetTip:100,sourceConfs:10})).state,'btc_missing_ancestor');
});
test('a standard opt-in signature anywhere in a confirmed XBT spend explains replay protection',async()=>{
 const f=fixture();f.tx.vin[0].prevout.scriptpubkey_type='v1_p2tr';f.tx.vin[0].witness=['11'.repeat(64)+'21'];
 const result=await assessReplay(f.session,f.tx,{source:'xbt',targetTip:100,sourceConfs:6});assert.equal(result.state,'xbt_opt_in');
 const immature=await assessReplay(f.session,f.tx,{source:'xbt',targetTip:100,sourceConfs:1});assert.notEqual(immature.state,'xbt_opt_in');
});
test('checker progress covers both directions and counts each transaction once',()=>{
 const rows=[{status:'btc_only',btc_tx:id(1),replay_state:'missing_ancestor'},{status:'btc_only',btc_tx:id(1),replay_state:'missing_ancestor'},{status:'xbt_only',xbt_tx:id(2),replay_state:'not_checked'},{status:'split',btc_tx:id(3),xbt_tx:id(4),replay_state:'different_spends'},{status:'protected',xbt_tx:id(5),replay_state:'xbt_opt_in'}];
 assert.deepEqual(checkerProgress(rows),{total:4,assessed:3,pending:1,states:{missing_ancestor:1,not_checked:1,different_spends:1,xbt_opt_in:1}});
 assert.equal(replayFields(rows[2],{state:'btc_missing_ancestor',detail:'missing',checked:1}).replay_state,'btc_missing_ancestor');
});

test('bidirectional migration preserves earlier BTC replay assessments',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../migrations/0005_replay_assessments.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO replay_assessments VALUES (?,?,?,?,?)').run(id(9),'missing_ancestor','existing reason',10,100);
 db.exec(readFileSync(new URL('../migrations/0006_bidirectional_replay.sql',import.meta.url),'utf8'));
 const row=db.prepare('SELECT * FROM replay_assessments').get();assert.equal(row.source_chain,'btc');assert.equal(row.detail,'existing reason');assert.equal(row.checked,10);
 db.prepare('INSERT INTO replay_assessments VALUES (?,?,?,?,?,?)').run('xbt',id(9),'btc_inputs_available','reverse',20,200);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM replay_assessments').get().n,2);db.close();
});
test('worker queues XBT-only observations and exports a reason in the reverse direction',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chainwatch-reverse-')),db=openDatabase(join(root,'state.sqlite')),f=fixture();
 db.sqlite.prepare('INSERT INTO addresses(address,entity,label,category,source,source_url,confidence,updated) VALUES (?,?,?,?,?,?,?,?)').run('watch','Example','Example','ETF','issuer','https://example.org','Public registry','2026-11-20');
 db.sqlite.prepare('INSERT INTO observations(outpoint,address,entity,value,xbt_tx,status,time,xbt_confs,detail,checked) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id(1)+':0','watch','Example',100,id(9),'xbt_only',START+100,10,'one-sided',START+200);
 const remote=async(chain,path)=>{
  if(path==='/tx/'+id(9))return {...f.tx,status:{confirmed:true,block_height:80,block_hash:'source'}};
  if(path==='/block-height/80')return 'source';if(path==='/block-height/50')return 'funding';if(path==='/block-height/961640')return FORK_HASH;if(path==='/blocks/tip/height')return 100;
  assert.equal(chain,'btc');if(path==='/tx/'+id(1))return f.parents.get(id(1));if(path.includes('/outspend/'))return {spent:false};throw Error('Unexpected '+path);
 };
 const result=await checkNextReplay(db.sqlite,{remote,limits:{minInterval:0},now:START+500});assert.equal(result.source,'xbt');assert.equal(result.state,'btc_inputs_available');
 const dir=join(root,'site'),m=exportSnapshot(db.sqlite,dir),rows=JSON.parse(readFileSync(join(dir,m.resultPath,m.eventFiles[0]),'utf8'));assert.equal(rows[0].replay_state,'btc_inputs_available');assert.match(rows[0].replay_detail,/unspent on BTC/);db.close();
});

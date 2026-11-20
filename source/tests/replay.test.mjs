import test from 'node:test';
import assert from 'node:assert/strict';
import {assessBtcReplay,replayFields,replaySummary} from '../lib/replay.mjs';
import {createXbtValidator} from '../local/xbt-validation.mjs';
import {checkNextReplay} from '../local/replay-worker.mjs';
import {FORK_HASH,START} from '../lib/evidence.mjs';
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
test('a later confirmed conflicting input outweighs an earlier missing parent',async()=>{const f=fixture();f.tx.vin.unshift({txid:id(2),vout:0});f.values.set('/tx/'+id(1)+'/outspend/0',{spent:true,txid:id(3),status:{confirmed:true,block_height:70,block_hash:'conflict'}});f.parents.set(id(3),{status:{confirmed:true,block_hash:'conflict'},vin:[{txid:id(1),vout:0}]});const r=await assessBtcReplay(f.session,f.tx,{xbtTip:100});assert.equal(r.state,'input_conflict');assert.match(r.detail,/six confirmations/)});
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
 const rows=[{status:'split',value:20},{status:'btc_only',value:100,replay_state:'node_accepted'},{status:'xbt_only',value:30}];assert.deepEqual(replaySummary(rows),{confirmedSplitValue:20,oneSidedValue:130,replayableValue:100,replayPending:0});
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

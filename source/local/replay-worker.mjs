import {createSession,BatchLimit,ExplorerError} from '../lib/collector.mjs';
import {FORK,FORK_HASH,confirmations} from '../lib/evidence.mjs';
import {assessReplay} from '../lib/replay.mjs';
import {safeMessage} from './public-data.mjs';
function workerState(db,state,now,extra={}){db.prepare("INSERT INTO meta(key,value) VALUES ('replay_worker',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({state,lastRun:now,...extra}));}
export async function checkNextReplay(db,{remote,validate,now=Math.floor(Date.now()/1000),limits={}}){
 const pause=db.prepare("SELECT value FROM meta WHERE key='explorer_pause'").get();
 if(Number(pause?.value)>now){workerState(db,'paused',now);return {paused:true};}
 const row=db.prepare(`WITH candidates AS (
  SELECT 'btc' source_chain,o.btc_tx txid,o.time,a.entity FROM observations o JOIN addresses a ON a.address=o.address
   WHERE o.status='btc_only' AND o.btc_confs>=1 AND o.btc_tx IS NOT NULL
  UNION ALL
  SELECT 'xbt' source_chain,o.xbt_tx txid,o.time,a.entity FROM observations o JOIN addresses a ON a.address=o.address
   WHERE o.status='xbt_only' AND o.xbt_confs>=1 AND o.xbt_tx IS NOT NULL
 ) SELECT c.source_chain,c.txid,COALESCE(r.checked,0) checked,
 MAX(CASE WHEN c.entity IN ('Bitwise Bitcoin ETF (BITB)','Coinbase','Silk Road','El Salvador') THEN 1 ELSE 0 END) priority
 FROM candidates c LEFT JOIN replay_assessments r ON r.txid=c.txid AND r.source_chain=c.source_chain
 WHERE COALESCE(r.next_attempt,0)<=?
 GROUP BY c.source_chain,c.txid ORDER BY checked,priority DESC,MAX(c.time) DESC LIMIT 1`).get(now);
 if(!row){workerState(db,'waiting',now);return {idle:true};}
 workerState(db,'checking',now,{source:row.source_chain,txid:row.txid});
 const cache={async get(key){const r=db.prepare('SELECT payload FROM scan_cache WHERE key=? AND expires>?').get(key,now);return r?JSON.parse(r.payload):null},async put(key,value,ttl){const text=JSON.stringify(value);if(text.length<=500000)db.prepare('INSERT INTO scan_cache(key,payload,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires=excluded.expires').run(key,text,now+ttl)},async delete(key){db.prepare('DELETE FROM scan_cache WHERE key=?').run(key)}};
 const session=createSession({fetcher:remote,cache,maxRequests:24,maxDuration:15000,minInterval:500,...limits});let result;
 const source=row.source_chain,target=source==='btc'?'xbt':'btc';
 try{
  const tx=await session.tx(source,row.txid);
  if(!tx||tx.txid!==row.txid||!tx.status?.confirmed)throw Error('Confirmed source transaction unavailable during replay assessment.');
  if(await session.get(source,`/block-height/${tx.status.block_height}`)!==tx.status.block_hash){await session.invalidate(source,row.txid);throw Error('Source spending block changed during replay assessment.');}
  if(await session.get('xbt',`/block-height/${FORK}`)!==FORK_HASH)throw Error('XBT explorer checkpoint mismatch during replay assessment.');
  const sourceTip=Number(await session.get(source,'/blocks/tip/height'));
  const targetTip=Number(await session.get(target,'/blocks/tip/height'));
  if(!Number.isInteger(sourceTip)||!Number.isInteger(targetTip))throw Error('Chain tip unavailable.');
  result=await assessReplay(session,tx,{source,targetTip,sourceConfs:confirmations(tx.status,sourceTip),validate});
 }catch(e){
  result=e instanceof BatchLimit?{state:'incomplete',detail:'Replay assessment reached its request or time budget; full validity was not established.'}:{state:'unavailable',detail:safeMessage(e.message||'Replay assessment failed.')};
  if(e instanceof ExplorerError&&e.status===429)db.prepare("INSERT INTO meta(key,value) VALUES ('explorer_pause',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now+Math.max(60,e.retryAfter)));
 }
 result.detail=safeMessage(result.detail);
 const retry=['incomplete','unavailable','input_pending','btc_input_pending'].includes(result.state)?300:3600;
 db.prepare('INSERT INTO replay_assessments(source_chain,txid,state,detail,checked,next_attempt) VALUES (?,?,?,?,?,?) ON CONFLICT(source_chain,txid) DO UPDATE SET state=excluded.state,detail=excluded.detail,checked=excluded.checked,next_attempt=excluded.next_attempt').run(source,row.txid,result.state,result.detail,now,now+retry);
 workerState(db,'running',now,{source,txid:row.txid,result:result.state});
 return {source,txid:row.txid,...result,requests:session.metrics.requests};
}

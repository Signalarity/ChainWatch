import {createSession,BatchLimit,ExplorerError} from '../lib/collector.mjs';
import {FORK,FORK_HASH} from '../lib/evidence.mjs';
import {assessBtcReplay} from '../lib/replay.mjs';
import {safeMessage} from './public-data.mjs';
export async function checkNextReplay(db,{remote,validate,now=Math.floor(Date.now()/1000),limits={}}){
 const pause=db.prepare("SELECT value FROM meta WHERE key='explorer_pause'").get();
 if(Number(pause?.value)>now)return {paused:true};
 const row=db.prepare(`SELECT o.btc_tx,COALESCE(r.checked,0) checked,
  MAX(CASE WHEN a.entity='Bitwise Bitcoin ETF (BITB)' THEN 1 ELSE 0 END) bitb
  FROM observations o JOIN addresses a ON a.address=o.address
  LEFT JOIN replay_assessments r ON r.txid=o.btc_tx
  WHERE o.status='btc_only' AND o.btc_confs>=1 AND o.btc_tx IS NOT NULL
  AND COALESCE(r.next_attempt,0)<=?
  GROUP BY o.btc_tx ORDER BY checked,bitb DESC,MAX(o.time) DESC LIMIT 1`).get(now);
 if(!row)return {idle:true};
 const cache={async get(key){const r=db.prepare('SELECT payload FROM scan_cache WHERE key=? AND expires>?').get(key,now);return r?JSON.parse(r.payload):null},async put(key,value,ttl){const text=JSON.stringify(value);if(text.length<=500000)db.prepare('INSERT INTO scan_cache(key,payload,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires=excluded.expires').run(key,text,now+ttl)},async delete(key){db.prepare('DELETE FROM scan_cache WHERE key=?').run(key)}};
 const session=createSession({fetcher:remote,cache,maxRequests:24,maxDuration:15000,minInterval:500,...limits});let result;
 try{
  const tx=await session.tx('btc',row.btc_tx);
  if(!tx||tx.txid!==row.btc_tx||!tx.status?.confirmed)throw Error('Confirmed BTC spend unavailable during replay assessment.');
  if(await session.get('btc',`/block-height/${tx.status.block_height}`)!==tx.status.block_hash){await session.invalidate('btc',row.btc_tx);throw Error('BTC spending block changed during replay assessment.');}
  if(await session.get('xbt',`/block-height/${FORK}`)!==FORK_HASH)throw Error('XBT explorer checkpoint mismatch during replay assessment.');
  const xbtTip=Number(await session.get('xbt','/blocks/tip/height'));if(!Number.isInteger(xbtTip))throw Error('XBT chain tip unavailable.');
  result=await assessBtcReplay(session,tx,{xbtTip,validate});
 }catch(e){
  result=e instanceof BatchLimit?{state:'incomplete',detail:'Replay assessment reached its request or time budget; full validity was not established.'}:{state:'unavailable',detail:safeMessage(e.message||'Replay assessment failed.')};
  if(e instanceof ExplorerError&&e.status===429)db.prepare("INSERT INTO meta(key,value) VALUES ('explorer_pause',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(now+Math.max(60,e.retryAfter)));
 }
 const retry=['incomplete','unavailable','input_pending'].includes(result.state)?300:3600;
 db.prepare('INSERT INTO replay_assessments(txid,state,detail,checked,next_attempt) VALUES (?,?,?,?,?) ON CONFLICT(txid) DO UPDATE SET state=excluded.state,detail=excluded.detail,checked=excluded.checked,next_attempt=excluded.next_attempt').run(row.btc_tx,result.state,result.detail,now,now+retry);
 return {txid:row.btc_tx,...result,requests:session.metrics.requests};
}

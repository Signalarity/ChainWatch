import {START,SHARED_HEIGHT,classify,confirmations,inscriptionSignal,signatureSignal,requiredUnifiedSignature} from './evidence.mjs';
export class BatchLimit extends Error {constructor(){super('Batch work budget reached');this.name='BatchLimit'}}
export class ExplorerError extends Error {constructor(message,status=0,retryAfter=0){super(message);this.status=status;this.retryAfter=retryAfter;this.name='ExplorerError'}}
// Per-batch memoization never caches failures or output-spending status across batches.
export function createSession({fetcher,cache,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxRequests=32,maxDuration=20000,minInterval=300}={}) {
 const started=clock(),memo=new Map(),known=new Map();let lastStart=-Infinity,gate=Promise.resolve(),active=0;const slots=[];
 const metrics={requests:0,memoryHits:0,persistentHits:0,historyHits:0,candidates:0,skippedPostFork:0,pages:0,addresses:0,observations:0};
 const elapsed=()=>clock()-started;
 async function get(chain,path,missing=false){const key=chain+':'+path;if(memo.has(key)){metrics.memoryHits++;return memo.get(key)}
  const pending=(async()=>{const turn=gate;let release;gate=new Promise(r=>release=r);await turn;
   try{if(active>=2)await new Promise(resolve=>slots.push(resolve));if(metrics.requests>=maxRequests||elapsed()>=maxDuration)throw new BatchLimit();const delay=Math.max(0,lastStart+minInterval-clock());if(delay)await sleep(delay);if(elapsed()>=maxDuration)throw new BatchLimit();metrics.requests++;lastStart=clock();active++}finally{release()}
   try{return await fetcher(chain,path,missing)}finally{active--;slots.shift()?.()}
  })();memo.set(key,pending);try{return await pending}catch(e){memo.delete(key);throw e}
 }
 function remember(chain,txs){for(const tx of txs)if(tx?.txid&&!tx._partial)known.set(chain+':'+tx.txid,tx)}
 async function tx(chain,id){const key=chain+':'+id;if(known.has(key)){metrics.memoryHits++;return known.get(key)}
  const cacheKey='tx:'+key,stored=await cache?.get(cacheKey);if(stored){metrics.persistentHits++;known.set(key,stored);return stored}
  const body=await get(chain,'/tx/'+id,true);if(body?.status?.confirmed){known.set(key,body);await cache?.put(cacheKey,body,86400)}return body;
 }
 async function invalidate(chain,id){known.delete(chain+':'+id);memo.delete(chain+':/tx/'+id);await cache?.delete('tx:'+chain+':'+id)}
 return {get,tx,remember,invalidate,cache,metrics,elapsed,available:()=>metrics.requests<maxRequests&&elapsed()<maxDuration};
}
export function pageKey(job){return 'page:'+job.id+':'+(job.done?'head:'+job.head_cursor:'history:'+job.cursor)}
// Cached pages freeze the candidate ordering when an input-heavy page spans batches.
export async function historyPage(session,job){const chain=job.chain,head=!!job.done,cursor=head?job.head_cursor:job.cursor,key=pageKey(job);let txs=await session.cache?.get(key),reused=!!txs;
 if(!txs){txs=await session.get(chain,`/address/${job.address}/txs/chain${cursor?'/'+cursor:''}`);if(!Array.isArray(txs))throw Error('Explorer returned an invalid address history.');await session.cache?.put(key,txs.map(tx=>({_partial:true,txid:tx.txid,status:tx.status,vin:(tx.vin||[]).filter(v=>v.prevout?.scriptpubkey_address===job.address).map(v=>({txid:v.txid,vout:v.vout,prevout:{scriptpubkey_address:v.prevout.scriptpubkey_address}}))})),3600)}else session.metrics.historyHits++;
 session.remember(chain,txs);

 // A page fingerprint lets expired or oversized snapshots resume when ordering is unchanged.
 let stop=false;const seen=new Set(),candidates=[];
 for(const current of txs){if(head&&job.head&&current.txid===job.head){stop=true;break}if(!current.status?.confirmed)continue;
  if(current.status.block_time<START){stop=true;continue}
  for(const input of current.vin||[]){if(input.prevout?.scriptpubkey_address!==job.address||!/^[a-f0-9]{64}$/.test(input.txid)||!Number.isInteger(input.vout)||input.vout<0)continue;
   const key=input.txid+':'+input.vout;if(!seen.has(key)){seen.add(key);candidates.push(input)}
  }
 }
 const bytes=new TextEncoder().encode(txs.map(tx=>tx.txid).join(':')+'|'+candidates.map(v=>v.txid+':'+v.vout).join('|'));
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const offset=reused||job.page_fingerprint===fingerprint?(head?job.head_offset:job.offset):0;
 return {txs,candidates,offset,key,fingerprint,stop:stop||txs.length<25,reused};
}
function verifySpend(parent,n,s,tx){if(!s.spent)return;
 if(!tx||tx.txid!==s.txid||!tx.vin?.some(v=>v.txid===parent&&v.vout===n))throw Error('Explorer spend did not reference the original output.');
 if(tx.status?.block_hash!==s.status?.block_hash||tx.status?.confirmed!==s.status?.confirmed)throw Error('Explorer confirmation status changed; retry.');
}
export async function inspectOutput(session,parentId,n,owner,tips){
 session.metrics.candidates++;
 // Usually one funding lookup is enough to rule out a post-fork input. Never request
 // outspends until the same original output has been established on both chains.
 const bp=await session.tx('btc',parentId);
 if(!bp)throw Error('BTC funding transaction data is unavailable.');
 if(!bp.status?.confirmed)return null;
 if(bp.status.block_height>SHARED_HEIGHT){session.metrics.skippedPostFork++;return null}
 const xp=await session.tx('xbt',parentId);
 if(!xp)throw Error('XBT funding transaction data is unavailable.');
 if(!xp.status?.confirmed||xp.status.block_height>SHARED_HEIGHT||bp.status.block_hash!==xp.status.block_hash)return null;
 const output=bp.vout?.[n],other=xp.vout?.[n];
 if(!output||!other||output.value!==other.value||output.scriptpubkey!==other.scriptpubkey||output.scriptpubkey_address!==owner.address)return null;
 if(!Number.isSafeInteger(output.value)||output.value<0)throw Error('Invalid output amount.');
 const [bs,xs]=await Promise.all([session.get('btc',`/tx/${parentId}/outspend/${n}`,true),session.get('xbt',`/tx/${parentId}/outspend/${n}`,true)]);
 if(!bs||!xs)throw Error('Original output spending data is unavailable; existing evidence was not replaced.');
 // Identical spends are irrelevant to the split-only result set. Return a tombstone
 // so a previously one-sided observation is removed without fetching both spend bodies.
 if(bs.spent&&xs.spent&&bs.txid&&bs.txid===xs.txid)return {outpoint:parentId+':'+n,status:'replayed'};
 const [bt,xt]=await Promise.all([bs.spent?session.tx('btc',bs.txid):null,xs.spent?session.tx('xbt',xs.txid):null]);
 try{
  verifySpend(parentId,n,bs,bt);verifySpend(parentId,n,xs,xt);
  for(const [chain,tx] of [['btc',bp],['xbt',xp],['btc',bt],['xbt',xt]]){
   if(tx?.status?.confirmed){const hash=await session.get(chain,`/block-height/${tx.status.block_height}`);if(hash!==tx.status.block_hash)throw Error('Transaction block changed during scan; retry.')}
  }
 }catch(e){if(e instanceof BatchLimit)throw e;for(const [chain,tx] of [['btc',bp],['xbt',xp],['btc',bt],['xbt',xt]])if(tx?.txid)await session.invalidate(chain,tx.txid);throw e}
 let result=classify({btc:bs,xbt:xs,btcTip:tips.btc,xbtTip:tips.xbt});
 if(result.status==='xbt_only'&&confirmations(xs.status,tips.xbt)>=6&&xt?.vin?.some(v=>v.txid===parentId&&v.vout===n&&requiredUnifiedSignature(v)))result={status:'protected',detail:'XBT explorer reports a 6+ confirmation spend whose standard signature position selects SIGHASH_UNIFIED (0x20). The original BTC output is reported unspent. General scripts are not inferred from witness patterns.'};
 const btime=bt?.status?.block_time||0,xtime=xt?.status?.block_time||0,time=Math.max(btime,xtime);if(time<START)return null;
 const inputs=[...(bt?.vin||[]),...(xt?.vin||[])];
 return {outpoint:parentId+':'+n,address:owner.address,entity:owner.entity,value:output.value,btc_tx:bs.txid||null,xbt_tx:xs.txid||null,status:result.status,time,btc_time:btime||null,xbt_time:xtime||null,btc_confs:confirmations(bs.status,tips.btc),xbt_confs:confirmations(xs.status,tips.xbt),inscription:Number(inputs.some(inscriptionSignal)),signature_signal:Number((xt?.vin||[]).some(signatureSignal)),detail:result.detail,checked:Math.floor(Date.now()/1000)};
}
// Both cursors survive retries; completed historical scans remain complete during head syncs.
export function advanceJob(job,page,processed,now){
 const complete=page.offset+processed>=page.candidates.length;
 const patch={cursor:job.cursor,offset:job.offset,done:job.done,head:job.head||page.txs[0]?.txid||'',head_cursor:job.head_cursor||'',head_offset:job.head_offset||0,target_head:job.target_head||'',next_attempt:0,checked:now,pages:job.pages+Number(complete),page_fingerprint:complete?'':page.fingerprint};
 if(!job.done){patch.offset=complete?0:page.offset+processed;if(complete){if(page.stop){patch.done=1;patch.next_attempt=now+3600}else patch.cursor=page.txs.at(-1).txid}}
 else {patch.target_head=job.target_head||page.txs[0]?.txid||'';patch.head_offset=complete?0:page.offset+processed;
  if(complete){if(page.stop){patch.head=patch.target_head;patch.target_head='';patch.head_cursor='';patch.next_attempt=now+3600}else patch.head_cursor=page.txs.at(-1).txid}
 }
 return {patch,complete};
}

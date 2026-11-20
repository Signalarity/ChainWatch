import seed from '../data/seed.json' with {type:'json'};
import catalog from '../data/catalog-meta.json' with {type:'json'};
import {isSplit} from '../local/public-data.mjs';
import {START,FORK,FORK_HASH,SHARED_HEIGHT,SHARED_HASH} from './evidence.mjs';
import {createSession,inspectOutput,historyPage,advanceJob,pageKey,BatchLimit,ExplorerError} from './collector.mjs';
export function createMonitor(getDatabase:any){
function database(){return typeof getDatabase==='function'?getDatabase():getDatabase;}
const API={btc:'https://mempool.space/api',xbt:'https://mempool.guide/api'};
type Chain=keyof typeof API;
type Row={address:string;entity:string;label:string;category:string;source:string;source_url:string;confidence:string;last_updated?:string};
async function ingest(rows:Row[]){
 if(!Array.isArray(rows)||rows.length>1000)throw new Error('Import up to 1,000 address records per request.');
 const valid=rows.filter(r=>/^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(r.address)&&[r.entity,r.label,r.category,r.source,r.confidence].every(x=>typeof x==='string'&&x.length<=300)&&/^https:\/\//.test(r.source_url));
 if(valid.length!==rows.length)throw new Error('Invalid attribution record.');
 const db=database(),statements=[];
 for(let i=0;i<rows.length;i+=10){const group=rows.slice(i,i+10);statements.push(db.prepare(`INSERT INTO addresses(address,entity,label,category,source,source_url,confidence,updated,priority) VALUES ${group.map(()=>'(?,?,?,?,?,?,?,?,?)').join(',')} ON CONFLICT(address) DO NOTHING`).bind(...group.flatMap(r=>[r.address,r.entity,r.label,r.category,r.source,r.source_url,r.confidence,r.last_updated||'2026-11-13',r.confidence==='Public registry'?0:1])));}
 if(statements.length){await db.batch(statements);await db.prepare("DELETE FROM scan_cache WHERE key='catalog-summary'").run()}return valid.length;
}
async function initialize(){const db=database();await db.prepare("DELETE FROM observations WHERE status='replayed'").run();const has=await db.prepare("SELECT value FROM meta WHERE key='seeded'").first();if(!has){await ingest(seed);await setMeta('seeded','yes');}}
async function setMeta(key:string,value:string){await database().prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run();}
async function remote(chain:Chain,path:string,missing=false):Promise<any>{
 const r=await fetch(API[chain]+path,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
 if(missing&&r.status===404)return null;
 if(!r.ok){const raw=r.headers.get('Retry-After')||'';const seconds=/^\d+$/.test(raw)?Number(raw):Math.max(0,Math.ceil((Date.parse(raw)-Date.now())/1000));throw new ExplorerError(`${chain.toUpperCase()} explorer returned HTTP ${r.status}; retry later.`,r.status,Number.isFinite(seconds)?Math.max(0,seconds):60)}
 const text=await r.text();try{return JSON.parse(text)}catch{return text.trim()}
}
const cacheStore=()=>({
 async get(key:string){const row:any=await database().prepare('SELECT payload FROM scan_cache WHERE key=? AND expires>?').bind(key,Math.floor(Date.now()/1000)).first();return row?JSON.parse(row.payload):null},
 async put(key:string,value:any,ttl:number){const payload=JSON.stringify(value);if(payload.length>500000)return;await database().prepare('INSERT INTO scan_cache(key,payload,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires=excluded.expires').bind(key,payload,Math.floor(Date.now()/1000)+ttl).run()},
 async delete(key:string){await database().prepare('DELETE FROM scan_cache WHERE key=?').bind(key).run()},
});
async function saveObservation(record:any){if(!isSplit(record)){await database().prepare('DELETE FROM observations WHERE outpoint=?').bind(record.outpoint).run();return false}const keys=Object.keys(record);await database().prepare(`INSERT INTO observations(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT(outpoint) DO UPDATE SET ${keys.filter(k=>k!=='outpoint').map(k=>`${k}=excluded.${k}`).join(',')}`).bind(...Object.values(record)).run();return true}
async function saveJob(id:string,patch:any){const keys=Object.keys(patch);await database().prepare(`UPDATE jobs SET ${keys.map(k=>k+'=?').join(',')},error=NULL WHERE id=?`).bind(...Object.values(patch),id).run()}
async function chooseOwner(now:number,turn:number){
 const db=database();
 // Finish the requested institutions first; completed histories return to the
 // ordinary head-check rotation so they cannot monopolize the collector.
 const priorityEntities=['Coinbase','Silk Road','El Salvador'];
 const first=turn%priorityEntities.length;
 // Rotate priority institutions so a long exchange history cannot starve
 // government reserves or historical seizure addresses (and vice versa).
 for(const entity of [...priorityEntities.slice(first),...priorityEntities.slice(0,first)]){
  // Newly attributed addresses get their first look before a long-running
  // history consumes further pages; saved cursors resume immediately afterward.
  const fresh=await db.prepare('SELECT a.* FROM addresses a WHERE a.entity=? AND a.checked=0 AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.address=a.address) ORDER BY a.priority,a.address LIMIT 1').bind(entity).first();
  if(fresh)return fresh;
  const active=await db.prepare('SELECT a.*,j.id AS job_id FROM addresses a JOIN jobs j ON j.address=a.address WHERE a.entity=? AND j.next_attempt<=? AND j.done=0 ORDER BY j.next_attempt,j.checked,j.id LIMIT 1').bind(entity,now).first();
  if(active)return active;
 }
 const unfinished=()=>db.prepare('SELECT a.*,j.id AS job_id FROM jobs j JOIN addresses a ON a.address=j.address WHERE j.next_attempt<=? AND j.done=0 ORDER BY j.next_attempt,j.checked,j.id LIMIT 1').bind(now).first();
 const heads=()=>db.prepare('SELECT a.*,j.id AS job_id FROM jobs j JOIN addresses a ON a.address=j.address WHERE j.next_attempt<=? AND j.done=1 ORDER BY j.next_attempt,j.checked,j.id LIMIT 1').bind(now).first();
 const fresh=()=>db.prepare('SELECT a.* FROM addresses a WHERE a.checked=0 AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.address=a.address) ORDER BY a.priority,a.address LIMIT 1').first();
 // A fixed work share prevents active histories and repeat head checks from starving
 // the broader catalog. None of these sorts traverses all attributed addresses.
 const order=turn%4===0?[heads,unfinished,fresh]:turn%4===3?[fresh,unfinished,heads]:[unfinished,fresh,heads];
 for(const query of order){const result=await query();if(result)return result}return null;
}
async function refresh(requested?:string,limits:{maxRequests?:number;maxDuration?:number;minInterval?:number}={}){
 await initialize();const db=database(),now=Math.floor(Date.now()/1000),until=String(now+90);
 const lock=await db.prepare("INSERT INTO meta(key,value) VALUES ('lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(meta.value AS INTEGER)<? RETURNING value").bind(until,now).first();
 if(!lock)return {busy:true,message:'A scan is already running.'};
 const session=createSession({fetcher:remote,cache:cacheStore(),...limits}),warnings:string[]=[],owners=new Set<string>();let last:any=null,stopped=false;
 try {
  const pause:any=await db.prepare("SELECT value FROM meta WHERE key='explorer_pause'").first();if(Number(pause?.value)>now)return {paused:true,retryAfter:Number(pause.value)-now,message:'Public explorer requested a cooldown.'};
  const [btc,xbt,sharedB,sharedX,fork]=await Promise.all([session.get('btc','/blocks/tip/height'),session.get('xbt','/blocks/tip/height'),session.get('btc',`/block-height/${SHARED_HEIGHT}`),session.get('xbt',`/block-height/${SHARED_HEIGHT}`),session.get('xbt',`/block-height/${FORK}`)]);
  if(sharedB!==SHARED_HASH||sharedX!==SHARED_HASH||fork!==FORK_HASH)throw new Error('Explorer chain checkpoint mismatch; scan stopped.');
  const tips={btc:Number(btc),xbt:Number(xbt)};if(!Number.isInteger(tips.btc)||!Number.isInteger(tips.xbt))throw new Error('Explorer tip unavailable.');
  await setMeta('tips',JSON.stringify(tips));
  if(requested&&!/^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(requested))throw new Error('Invalid address.');
  // Revalidate old evidence before spending the batch's remaining budget on discovery.
  const old:any=await db.prepare('SELECT o.*,a.entity FROM observations o JOIN addresses a ON a.address=o.address WHERE o.checked<? ORDER BY o.checked LIMIT 1').bind(now-3600).first();
  if(old){try{const [pid,n]=old.outpoint.split(':');const updated=await inspectOutput(session,pid,Number(n),old,tips);if(updated)await saveObservation(updated);else await db.prepare("UPDATE observations SET status='unknown',detail='Original evidence no longer satisfies shared-output or date checks.',checked=? WHERE outpoint=?").bind(now,old.outpoint).run()}catch(e){if(e instanceof BatchLimit)stopped=true;else{await db.prepare("UPDATE observations SET status='unknown',detail='Recheck failed; evidence is excluded from the ranking.',checked=? WHERE outpoint=?").bind(now,old.outpoint).run();if(e instanceof ExplorerError&&e.status===429)throw e;warnings.push(e instanceof Error?e.message:'Evidence recheck failed')}}}
  if(requested)await db.prepare('UPDATE jobs SET next_attempt=0 WHERE address=?').bind(requested).run();
  const round:any=await db.prepare("SELECT value FROM meta WHERE key='queue_round'").first();let turn=Number(round?.value)||0;
  for(let step=0;step<24&&!stopped&&session.available();step++,turn++){
   const owner:any=requested?await db.prepare('SELECT * FROM addresses WHERE address=?').bind(requested).first():await chooseOwner(now,turn);
   if(!owner){if(requested)throw Error('Address is not in the attributed watchlist. Add a source first.');break}
   await db.batch(['btc','xbt'].map(chain=>db.prepare('INSERT OR IGNORE INTO jobs(id,address,chain) VALUES (?,?,?)').bind(owner.address+':'+chain,owner.address,chain)));
   const job:any=owner.job_id?await db.prepare('SELECT * FROM jobs WHERE id=?').bind(owner.job_id).first():await db.prepare('SELECT * FROM jobs WHERE address=? AND next_attempt<=? ORDER BY checked,chain LIMIT 1').bind(owner.address,now).first();
   if(!job)break;
   let page:any,processed=0,found=0,failure:any,currentOutpoint:string|undefined;
   try{
    page=await historyPage(session,job);
    for(const input of page.candidates.slice(page.offset)){
     if(!session.available()||session.metrics.candidates>=1000){stopped=true;break}
     currentOutpoint=input.txid+':'+input.vout;
     const record=await inspectOutput(session,input.txid,input.vout,owner,tips);if(record&&await saveObservation(record)){found++;session.metrics.observations++}processed++;currentOutpoint=undefined;
    }
   }catch(e){if(e instanceof BatchLimit)stopped=true;else failure=e}
   if(page){const {patch,complete}=advanceJob(job,page,processed,now);await saveJob(job.id,patch);if(complete){session.metrics.pages++;await session.cache.delete(page.key)}
    last={address:owner.address,entity:owner.entity,chain:job.chain,found,pageComplete:complete,historyComplete:!!patch.done,checked:now};
    owners.add(owner.address);
    const other:any=await db.prepare('SELECT MIN(CASE WHEN error IS NULL THEN checked ELSE 0 END) AS n FROM jobs WHERE address=?').bind(owner.address).first();
    if(other.n>owner.checked)await db.prepare('UPDATE addresses SET checked=? WHERE address=?').bind(now,owner.address).run();
   }
   if(failure){if(currentOutpoint)await db.prepare("UPDATE observations SET status='unknown',detail='Current explorer verification failed; evidence is excluded from the ranking.',checked=? WHERE outpoint=?").bind(now,currentOutpoint).run();await session.cache.delete(page?.key||pageKey(job));await db.prepare('UPDATE jobs SET error=?,next_attempt=?,checked=? WHERE id=?').bind(failure.message||'Explorer scan failed',now+(failure.retryAfter||60),now,job.id).run();if(failure instanceof ExplorerError&&failure.status===429)throw failure;warnings.push(failure.message||'Explorer scan failed')}
  }
  await setMeta('queue_round',String(turn));
  await db.prepare('DELETE FROM scan_cache WHERE key IN (SELECT key FROM scan_cache WHERE expires<? ORDER BY expires LIMIT 50)').bind(now).run();
  session.metrics.addresses=owners.size;
  const metrics={...session.metrics,elapsedMs:session.elapsed(),warnings,limited:stopped};
  await db.batch([
   db.prepare("INSERT INTO meta(key,value) VALUES ('scan_metrics',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(metrics)),
   db.prepare("INSERT INTO meta(key,value) VALUES ('last_scan',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(now)),
   db.prepare("INSERT INTO meta(key,value) VALUES ('last_error',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(warnings.join('; ').slice(0,1000)),
  ]);
  return {...last,metrics,checked:now,idle:!last,message:!last?'No queued work is due yet.':undefined};
 }catch(e){const message=e instanceof Error?e.message:'Scan failed.';await setMeta('last_error',message);if(e instanceof ExplorerError&&e.status===429)await setMeta('explorer_pause',String(now+Math.max(60,e.retryAfter)));throw e
 }finally{await db.prepare("DELETE FROM meta WHERE key='lease' AND value=?").bind(until).run()}
}
async function dashboard(params:URLSearchParams){
 await initialize();const db=database();
 const parsed=Date.parse(params.get('start')||'2026-09-01');const start=Number.isFinite(parsed)?Math.max(START,Math.floor(parsed/1000)):START;
 const endText=params.get('end');const parsedEnd=endText?Date.parse(endText):NaN;const end=Number.isFinite(parsedEnd)?Math.floor(parsedEnd/1000)+86400:2147483647;
 const q=(params.get('q')||'').slice(0,150),status=params.get('status')||'',category=params.get('category')||'';
 const where=['o.time>=?','o.time<?',"o.status IN ('split','protected','btc_only','xbt_only')"],bindings:any[]=[start,end];
 if(q){where.push('(o.entity LIKE ? OR o.address LIKE ? OR o.btc_tx LIKE ? OR o.xbt_tx LIKE ?)');bindings.push(...Array(4).fill('%'+q.replace(/[%_]/g,'')+'%'));}
 if(status){where.push('o.status=?');bindings.push(status)}
 if(category){where.push('a.category=?');bindings.push(category)}
 const sql='FROM observations o JOIN addresses a ON a.address=o.address WHERE '+where.join(' AND ');
 const cache=cacheStore();let summary=await cache.get('catalog-summary');if(!summary){const [coverage,categories]=await Promise.all([db.prepare('SELECT COUNT(*) addresses,COUNT(DISTINCT entity) entities FROM addresses').first(),db.prepare('SELECT category,COUNT(*) count FROM addresses GROUP BY category ORDER BY count DESC').all()]);summary={coverage,categories:categories.results};await cache.put('catalog-summary',summary,86400)}
 const [events,top,counts,checked,health]=await Promise.all([
  db.prepare('SELECT o.*,a.category,a.confidence,a.source_url '+sql+' ORDER BY o.time DESC LIMIT 200').bind(...bindings).all(),
  db.prepare("SELECT o.btc_tx,o.xbt_tx,SUM(o.value) value,COUNT(*) inputs,GROUP_CONCAT(DISTINCT o.entity) entities,MAX(o.time) time "+sql+" AND o.status IN ('split','protected','btc_only','xbt_only') GROUP BY o.btc_tx,o.xbt_tx ORDER BY value DESC LIMIT 10").bind(...bindings).all(),
  db.prepare('SELECT o.status,COUNT(*) count,SUM(o.value) value '+sql+' GROUP BY o.status').bind(...bindings).all(),
  db.prepare('SELECT COUNT(*) checked FROM addresses WHERE checked>0').first(),
  db.prepare('SELECT key,value FROM meta WHERE key IN (\'last_scan\',\'last_error\',\'tips\',\'scan_metrics\')').all(),
 ]);
 const jobsCount=await db.prepare('SELECT COUNT(*) jobs,SUM(done) completed,SUM(pages) pages FROM jobs').first();
 return {events:events.results,top:top.results,counts:counts.results,coverage:{...summary.coverage,...checked}, categories:summary.categories,health:Object.fromEntries(health.results.map((x:any)=>[x.key,x.value])),jobs:jobsCount,catalog,window:{start,end},fork:{height:FORK,hash:FORK_HASH,timestamp:1788070477,sharedHeight:SHARED_HEIGHT,sharedHash:SHARED_HASH},asOf:Math.floor(Date.now()/1000)};
}

return {database,initialize,ingest,remote,refresh,dashboard};
}

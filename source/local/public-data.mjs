import {START} from '../lib/evidence.mjs';
export const PUBLIC_ADDRESS_FIELDS=['address','entity','label','category','confidence','source_url','source','updated'];
export const PUBLIC_OBSERVATION_FIELDS=['outpoint','address','entity','value','btc_tx','xbt_tx','status','time','btc_time','xbt_time','btc_confs','xbt_confs','inscription','signature_signal','detail','checked','category','confidence','source_url'];
export function pick(row,fields){return Object.fromEntries(fields.map(k=>[k,row[k]??null]))}
export function safeMessage(value){const s=String(value||'');return /(?:\/home\/|\/tmp\/|cookie|authorization|bearer|token|password|secret|private.?key)/i.test(s)?'Collector reported a temporary error; the last verified results are retained.':s.slice(0,500)}
export function addressBucket(address){const a=address.startsWith('bc1')?address.toLowerCase():address;if(/^bc1[qp][a-z0-9]{2}/.test(a))return 'b-'+a.slice(4,6);if(/^[13][a-km-zA-HJ-NP-Z1-9]{2}/.test(a))return a[0]+'-'+a.slice(1,3);return null}
export function splitDetail(r){if(r.status==='btc_only')return 'Observed split: the original output was spent on BTC and remains unspent on XBT at the last check.';if(r.status==='xbt_only')return 'Observed split: the original output was spent on XBT and remains unspent on BTC at the last check.';return r.detail}
export function isSplit(r){return r.status==='split'&&r.btc_tx&&r.xbt_tx&&r.btc_tx!==r.xbt_tx&&r.btc_confs>=6&&r.xbt_confs>=6||r.status==='protected'&&r.xbt_tx&&r.xbt_confs>=6||r.status==='btc_only'&&r.btc_tx&&r.btc_confs>=1||r.status==='xbt_only'&&r.xbt_tx&&r.xbt_confs>=1}
export function filterObservations(rows,params){const s=Date.parse(params.get('start')||'2026-09-01'),start=Number.isFinite(s)?Math.max(START,s/1000):START;const e=Date.parse(params.get('end')||''),end=Number.isFinite(e)?e/1000+86400:Infinity,q=(params.get('q')||'').toLowerCase(),status=params.get('status'),category=params.get('category'),institution=params.get('institution');return rows.filter(r=>isSplit(r)&&r.time>=start&&r.time<end&&(!q||[r.entity,r.address,r.btc_tx,r.xbt_tx].some(v=>String(v||'').toLowerCase().includes(q)))&&(!status||r.status===status)&&(!category||r.category===category)&&(!institution||r.entity===institution))}
export function ranked(rows){const groups=new Map();for(const r of rows){if(!isSplit(r))continue;const key=(r.btc_tx||'')+':'+r.xbt_tx;if(!groups.has(key))groups.set(key,{btc_tx:r.btc_tx,xbt_tx:r.xbt_tx,value:0,inputs:0,entities:new Set(),time:0,status:r.status,detail:r.detail});const g=groups.get(key);g.value+=r.value;g.inputs++;g.entities.add(r.entity);g.time=Math.max(g.time,r.time)}return [...groups.values()].sort((a,b)=>b.value-a.value).slice(0,10).map(g=>({...g,entities:[...g.entities].join(',')}))}
export function groupByInstitution(rows){
 const groups=new Map();
 for(const row of rows){
  if(!groups.has(row.entity))groups.set(row.entity,{entity:row.entity,value:0,checked:0,time:0,addresses:new Set(),records:[]});
  const group=groups.get(row.entity);group.value+=row.value;group.checked=Math.max(group.checked,row.checked||0);group.time=Math.max(group.time,row.time||0);group.addresses.add(row.address);group.records.push(row);
 }
 return [...groups.values()].sort((a,b)=>b.time-a.time||a.entity.localeCompare(b.entity)).map(group=>({...group,addressCount:group.addresses.size,addresses:undefined,count:group.records.length,records:[...group.records].sort((a,b)=>b.time-a.time||a.outpoint.localeCompare(b.outpoint))}));
}

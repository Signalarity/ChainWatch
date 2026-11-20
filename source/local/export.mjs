import {mkdirSync,writeFileSync,renameSync,readFileSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PUBLIC_ADDRESS_FIELDS,PUBLIC_OBSERVATION_FIELDS,pick,safeMessage,addressBucket,isSplit,splitDetail} from './public-data.mjs';
import {replayFields} from '../lib/replay.mjs';
import {START,FORK,FORK_HASH,SHARED_HEIGHT,SHARED_HASH} from '../lib/evidence.mjs';
function json(file,value){mkdirSync(resolve(file,'..'),{recursive:true});const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(value)+'\n');renameSync(tmp,file)}
function hash(value){return createHash('sha256').update(value).digest('hex').slice(0,24)}
export function exportSnapshot(sqlite,outputDir,{now=Date.now()}={}){
 outputDir=resolve(outputDir);mkdirSync(outputDir,{recursive:true});const all=sqlite.prepare('SELECT address,entity,label,category,confidence,source_url,source,updated FROM addresses ORDER BY entity,address');
 const digest=createHash('sha256');for(const row of all.iterate())digest.update(JSON.stringify(pick(row,PUBLIC_ADDRESS_FIELDS))+'\n');const catalogId=digest.digest('hex').slice(0,24),catalogRoot=join(outputDir,'data/catalog',catalogId);
 let directory;
 if(existsSync(join(catalogRoot,'directory.json')))directory=JSON.parse(readFileSync(join(catalogRoot,'directory.json'),'utf8'));
 else{
  mkdirSync(catalogRoot,{recursive:true});directory={schemaVersion:1,entities:[],categories:[],addresses:0};const entities=new Map(),buckets=new Map(),categories=new Map();let rows=[];
  function saveRows(entity){if(!rows.length)return;const file='entity-'+entity.id+'-'+entity.files.length+'.json',counts={};for(const r of rows)counts[r.category]=(counts[r.category]||0)+1;json(join(catalogRoot,file),rows);entity.files.push({file,count:rows.length,categories:counts});rows=[]}
  for(const raw of all.iterate()){
   const row=pick(raw,PUBLIC_ADDRESS_FIELDS);let entity=entities.get(row.entity);if(!entity){if(directory.entities.length)saveRows(directory.entities.at(-1));entity={id:directory.entities.length,name:row.entity,count:0,aliases:[],categories:{},files:[]};entities.set(row.entity,entity);directory.entities.push(entity)}
   if(rows.length===500)saveRows(entity);const file='entity-'+entity.id+'-'+entity.files.length+'.json';rows.push(row);entity.count++;entity.categories[row.category]=(entity.categories[row.category]||0)+1;
   if(entity.aliases.length<100&&row.label!==row.entity&&!entity.aliases.includes(row.label))entity.aliases.push(row.label);
   categories.set(row.category,(categories.get(row.category)||0)+1);directory.addresses++;
   const bucket=addressBucket(row.address);if(bucket){if(!buckets.has(bucket))buckets.set(bucket,[]);buckets.get(bucket).push([row.address,entity.id,file])}
  }
  if(directory.entities.length)saveRows(directory.entities.at(-1));
  for(const [bucket,entries]of buckets){entries.sort((a,b)=>a[0].localeCompare(b[0]));json(join(catalogRoot,'lookup',bucket+'.json'),entries)}
  directory.categories=[...categories].map(([category,count])=>({category,count}));json(join(catalogRoot,'directory.json'),directory);
 }
 const assessments=new Map(sqlite.prepare('SELECT txid,state,detail,checked FROM replay_assessments').all().map(r=>[r.txid,r]));
 const observations=sqlite.prepare('SELECT o.*,a.category,a.confidence,a.source_url FROM observations o JOIN addresses a ON a.address=o.address WHERE o.time>=? ORDER BY o.time DESC,o.outpoint').all(START).filter(isSplit).map(r=>({...pick({...r,...replayFields(r,assessments.get(r.btc_tx))},PUBLIC_OBSERVATION_FIELDS),detail:splitDetail(r)}));
 const progress=sqlite.prepare('SELECT address,checked FROM addresses WHERE checked>0 ORDER BY address').all().map(r=>[r.address,r.checked]);
 const meta=Object.fromEntries(sqlite.prepare("SELECT key,value FROM meta WHERE key IN ('last_scan','last_error','tips','scan_metrics')").all().map(r=>[r.key,r.value]));
 if(meta.last_error)meta.last_error=safeMessage(meta.last_error);
 if(meta.scan_metrics){try{const m=JSON.parse(meta.scan_metrics);meta.scan_metrics=JSON.stringify({...m,warnings:(m.warnings||[]).map(safeMessage)})}catch{delete meta.scan_metrics}}
 const jobs=sqlite.prepare('SELECT COUNT(*) jobs,COALESCE(SUM(done),0) completed,COALESCE(SUM(pages),0) pages FROM jobs').get();
 const resultId=hash(JSON.stringify({observations,progress,meta,jobs})),resultRoot=join(outputDir,'data/results',resultId),eventFiles=[];
 for(let i=0;i<observations.length;i+=2000){const file='events-'+i/2000+'.json';eventFiles.push(file);json(join(resultRoot,file),observations.slice(i,i+2000))}
 json(join(resultRoot,'progress.json'),progress);
 const manifest={schemaVersion:1,generatedAt:Math.floor(now/1000),asOf:Math.floor(now/1000),collector:'publisher-computer',catalogPath:'data/catalog/'+catalogId+'/',resultPath:'data/results/'+resultId+'/',eventFiles,observationCount:observations.length,coverage:{addresses:directory.addresses,entities:directory.entities.length,checked:progress.length},categories:directory.categories,jobs,health:meta,window:{start:START},fork:{height:FORK,hash:FORK_HASH,sharedHeight:SHARED_HEIGHT,sharedHash:SHARED_HASH,timestamp:1788070477}};
 let previous;try{previous=JSON.parse(readFileSync(join(outputDir,'data/manifest.json'),'utf8'))}catch{}
 // Keep a prior generation available for readers that loaded its manifest just before publication.
 json(join(outputDir,'data/manifest.json'),manifest);
 for(const [folder,current,prior]of [['catalog',catalogId,previous?.catalogPath?.split('/')[2]],['results',resultId,previous?.resultPath?.split('/')[2]]]){
  const root=join(outputDir,'data',folder);for(const entry of readdirSync(root,{withFileTypes:true}))if(entry.isDirectory()&&/^[a-f0-9]{24}$/.test(entry.name)&&![current,prior].includes(entry.name))rmSync(join(root,entry.name),{recursive:true});
 }
 return manifest;
}

import {addressBucket,filterObservations,ranked,groupByInstitution} from '../local/public-data.mjs';
export function createSnapshotClient({baseUrl,fetcher=globalThis.__CHAINWATCH_EMBEDDED_FETCH__||fetch}={}){
 const base=new URL(baseUrl||'./',typeof document==='undefined'?'http://localhost/':document.baseURI),files=new Map();let manifest,directory,progress,observations,lastLoad=0,pending;
 async function get(path){const url=new URL(path,base);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw Error('Invalid public result path');const r=await fetcher(url);if(!r.ok)throw Error('Published results are unavailable (HTTP '+r.status+').');return r.json()}
 async function file(path){if(files.has(path))return files.get(path);const value=await get(path);files.set(path,value);if(files.size>64)files.delete(files.keys().next().value);return value}
 async function load(force=false){if(pending)return pending;if(manifest&&!force&&Date.now()-lastLoad<30000)return manifest;
  pending=(async()=>{const next=await get('data/manifest.json?refresh='+Date.now());if(next.schemaVersion!==1)throw Error('Unsupported result format');
   if(!manifest||manifest.catalogPath!==next.catalogPath)directory=undefined;
   if(!manifest||manifest.resultPath!==next.resultPath){observations=undefined;progress=undefined}
   manifest=next;lastLoad=Date.now();return manifest})();try{return await pending}finally{pending=undefined}
 }
 async function directoryData(){await load();if(!directory)directory=await file(manifest.catalogPath+'directory.json');return directory}
 async function progressData(){await load();if(!progress)progress=new Map(await file(manifest.resultPath+'progress.json'));return progress}
 async function eventData(){await load();if(!observations){observations=[];for(const name of manifest.eventFiles)observations.push(...await file(manifest.resultPath+name))}return observations}
 async function dashboard(params){const m=await load(),catalog=await directoryData(),rows=filterObservations(await eventData(),params),counts=new Map();for(const r of rows){const x=counts.get(r.status)||{status:r.status,count:0,value:0};x.count++;x.value+=r.value;counts.set(r.status,x)}return {...m,events:rows.slice(0,200),observationGroups:groupByInstitution(rows),top:ranked(rows),counts:[...counts.values()],summary:{totalSplitValue:rows.reduce((sum,r)=>sum+r.value,0)},institutions:catalog.entities.map(e=>e.name).sort((a,b)=>a.localeCompare(b)),health:{...m.health},window:{start:Math.max(1788220800,Date.parse(params.get('start')||'2026-09-01')/1000)}}}
 async function addresses(params){const d=await directoryData(),q=(params.get('q')||'').trim(),category=params.get('category')||'',institution=params.get('institution')||'',offset=Math.max(0,Number(params.get('offset'))||0),checked=await progressData();
  const matches=d.entities.filter(e=>(!institution||e.name===institution)&&(!q||e.name.toLowerCase().includes(q.toLowerCase())||e.aliases.some(a=>a.toLowerCase().includes(q.toLowerCase())))&&(!category||e.categories[category]));
  let rows=[],total=0;
  if(matches.length){const wantedStart=offset,wantedEnd=offset+50;for(const entity of matches)for(const chunk of entity.files){const n=category?(chunk.categories[category]||0):chunk.count;if(total+n>wantedStart&&total<wantedEnd){const data=(await file(manifest.catalogPath+chunk.file)).filter(r=>!category||r.category===category);rows.push(...data.slice(Math.max(0,wantedStart-total),Math.min(n,wantedEnd-total)))}total+=n}}
  else if(q){const bucket=addressBucket(q);if(!bucket)return {rows:[],total:0,offset,message:institution?'':'Search an institution, full address, or an address prefix (at least three characters; six for bc1).'};
   let lookups=[];try{lookups=await file(manifest.catalogPath+'lookup/'+bucket+'.json')}catch{return {rows:[],total:0,offset}}
   const entries=lookups.filter(r=>r[0].startsWith(q.startsWith('bc1')?q.toLowerCase():q));const cache=new Map();for(const entry of entries){if(!cache.has(entry[2]))cache.set(entry[2],await file(manifest.catalogPath+entry[2]));const row=cache.get(entry[2]).find(r=>r.address===entry[0]);if(row&&(!category||row.category===category)&&(!institution||row.entity===institution)){if(total>=offset&&rows.length<50)rows.push(row);total++}}
  }
  return {rows:rows.map(r=>({...r,checked:checked.get(r.address)||0})),total,offset};
 }
 return {load,dashboard,addresses,refresh:()=>load(true)};
}

import {readFile,open} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {loadConfig} from './config.mjs';
import {openDatabase} from './database.mjs';
import {createMonitor} from '../lib/monitor-core.ts';
import {isSplit} from './public-data.mjs';
import {exportSnapshot} from './export.mjs';
const args=process.argv.slice(2),ci=args.indexOf('--config');const config=loadConfig(ci>=0?args.splice(ci,2)[1]:undefined),command=args.shift();
const db=openDatabase(config.database),monitor=createMonitor(db.d1);await monitor.initialize();
try{
 if(command==='import'){
  const file=args.shift();if(!file)throw Error('Provide a JSON array or NDJSON attribution file');let count=0,batch=[];
  async function flush(){if(!batch.length)return;await monitor.ingest(batch);count+=batch.length;batch=[];if(count%10000===0)console.log(JSON.stringify({imported:count}))}
  if(/\.ndjson$/i.test(file)){const lines=createInterface({input:createReadStream(file),crlfDelay:Infinity});for await(const line of lines){if(!line.trim())continue;batch.push(JSON.parse(line));if(batch.length===1000)await flush()}}
  else{const rows=JSON.parse(await readFile(file,'utf8'));for(const row of rows){batch.push(row);if(batch.length===1000)await flush()}}
  await flush();console.log(JSON.stringify({imported:count,addresses:db.sqlite.prepare('SELECT COUNT(*) n FROM addresses').get().n}));
 }else if(command==='import-results'){
  const data=JSON.parse(await readFile(args.shift(),'utf8'));let count=0;
  const keys=['outpoint','address','entity','value','btc_tx','xbt_tx','status','time','btc_time','xbt_time','btc_confs','xbt_confs','inscription','signature_signal','detail','checked'];
  const insert=db.sqlite.prepare(`INSERT OR IGNORE INTO observations(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`);
  for(const r of data.events||data){if(!isSplit(r))continue;if(!db.sqlite.prepare('SELECT address FROM addresses WHERE address=?').get(r.address))continue;if(!/^[a-f0-9]{64}:\d+$/.test(r.outpoint)||!Number.isSafeInteger(r.value)||r.value<0)throw Error('Invalid result record');insert.run(...keys.map(k=>r[k]??null));count++}
  console.log(JSON.stringify({importedObservations:count}));
 }else if(command==='export'){console.log(JSON.stringify(exportSnapshot(db.sqlite,config.outputDir)))}
 else if(command==='scan'){const result=await monitor.refresh(undefined,{maxRequests:64,maxDuration:45000,minInterval:500});console.log(JSON.stringify(result));exportSnapshot(db.sqlite,config.outputDir)}
 else if(command==='status'){console.log(JSON.stringify({addresses:db.sqlite.prepare('SELECT COUNT(*) n FROM addresses').get().n,jobs:db.sqlite.prepare('SELECT COUNT(*) jobs,SUM(done) completed,SUM(pages) pages FROM jobs').get(),meta:db.sqlite.prepare("SELECT key,value FROM meta WHERE key IN ('last_scan','last_error','scan_metrics')").all()}))}
 else throw Error('Commands: import FILE, import-results FILE, scan, export, status');
}finally{db.close()}

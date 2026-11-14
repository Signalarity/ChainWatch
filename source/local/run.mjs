import {existsSync,copyFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig} from './config.mjs';
import {openDatabase} from './database.mjs';
import {createMonitor} from '../lib/monitor-core.ts';
import {exportSnapshot} from './export.mjs';
import {publish} from './publish.mjs';
import {serve} from './serve.mjs';
const args=process.argv.slice(2),at=args.indexOf('--config'),config=loadConfig(at>=0?args[at+1]:undefined),db=openDatabase(config.database),monitor=createMonitor(db.d1);
await monitor.initialize();
function assets(){const root=join(config.projectRoot,'pages-dist');if(!existsSync(join(root,'index.html')))throw Error('Build the static dashboard first with npm run build');for(const name of ['index.html','.nojekyll'])copyFileSync(join(root,name),join(config.outputDir,name));mkdirSync(join(config.outputDir,'assets'),{recursive:true});for(const name of readdirSync(join(root,'assets')))copyFileSync(join(root,'assets',name),join(config.outputDir,'assets',name))}
mkdirSync(config.outputDir,{recursive:true});assets();exportSnapshot(db.sqlite,config.outputDir);
const server=config.previewPort?await serve(config.outputDir,config.previewPort):null;
console.log(JSON.stringify({status:'collector started',preview:'http://127.0.0.1:'+config.previewPort}));
let stop=false,wake,lastExport=0,lastPublish=0,failures=0,publishing;
function requestStop(){stop=true;wake?.()}process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);
const sleep=ms=>new Promise(r=>{const timer=setTimeout(r,ms);wake=()=>{clearTimeout(timer);r()}});
try{while(!stop){let delay=config.batchIntervalSeconds*1000;
 try{const result=await monitor.refresh(undefined,{maxRequests:64,maxDuration:45000,minInterval:500});console.log(JSON.stringify(result));failures=0;if(result.busy||result.paused||result.idle)delay=Math.max(delay,(result.retryAfter||30)*1000)}
 catch(e){failures++;delay=Math.min(300000,10000*2**Math.min(failures-1,5));console.error(JSON.stringify({scanError:e.message,retryMs:delay}))}
 const now=Date.now();
 if(now-lastExport>=config.snapshotIntervalSeconds*1000){exportSnapshot(db.sqlite,config.outputDir);lastExport=now}
 if(config.publishRepo&&!publishing&&now-lastPublish>=config.publishIntervalSeconds*1000){lastPublish=now;publishing=publish(config).then(r=>console.log(JSON.stringify(r))).catch(e=>console.error(JSON.stringify({publishError:e.message}))).finally(()=>{publishing=undefined})}
 await sleep(delay);
}}finally{if(publishing)await publishing;exportSnapshot(db.sqlite,config.outputDir);server?.close();db.close()}

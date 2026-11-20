import {existsSync,copyFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig} from './config.mjs';
import {openDatabase} from './database.mjs';
import {createMonitor} from '../lib/monitor-core.ts';
import {exportSnapshot} from './export.mjs';
import {publish} from './publish.mjs';
import {serve} from './serve.mjs';
import {checkNextReplay} from './replay-worker.mjs';
import {createXbtValidator} from './xbt-validation.mjs';
import {createRequestGate} from '../lib/request-gate.mjs';
import {ExplorerError} from '../lib/collector.mjs';
import {runConcurrentLoops} from './loops.mjs';
const args=process.argv.slice(2),at=args.indexOf('--config'),config=loadConfig(at>=0?args[at+1]:undefined),db=openDatabase(config.database);
let monitor;
const remote=createRequestGate((...args)=>monitor.remote(...args),{minInterval:500,maxConcurrent:2,beforeRequest(){
 const until=Number(db.sqlite.prepare("SELECT value FROM meta WHERE key='explorer_pause'").get()?.value)||0,now=Math.floor(Date.now()/1000);
 if(until>now)throw new ExplorerError('Public explorer cooldown is active.',429,until-now);
}});
monitor=createMonitor(db.d1,{remote});
await monitor.initialize();
const validateReplay=createXbtValidator(config);
function assets(){const root=join(config.projectRoot,'pages-dist');if(!existsSync(join(root,'index.html')))throw Error('Build the static dashboard first with npm run build');for(const name of ['index.html','.nojekyll'])copyFileSync(join(root,name),join(config.outputDir,name));mkdirSync(join(config.outputDir,'assets'),{recursive:true});for(const name of readdirSync(join(root,'assets')))copyFileSync(join(root,'assets',name),join(config.outputDir,'assets',name))}
mkdirSync(config.outputDir,{recursive:true});assets();exportSnapshot(db.sqlite,config.outputDir);
const server=config.previewPort?await serve(config.outputDir,config.previewPort):null;
console.log(JSON.stringify({status:'collector and independent replay checker started',preview:'http://127.0.0.1:'+config.previewPort}));
const controller=new AbortController();
process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
let failures=0,lastExport=Date.now(),lastPublish=0;
async function discovery(){
 let delay=config.batchIntervalSeconds*1000;
 try{const result=await monitor.refresh(undefined,{maxRequests:64,maxDuration:45000,minInterval:0});console.log(JSON.stringify(result));failures=0;if(result.busy||result.paused||result.idle)delay=Math.max(delay,(result.retryAfter||30)*1000);}
 catch(e){failures++;delay=Math.min(300000,10000*2**Math.min(failures-1,5));console.error(JSON.stringify({scanError:e.message,retryMs:delay}));}
 return delay;
}
async function replay(){
 try{const result=await checkNextReplay(db.sqlite,{remote,validate:validateReplay,limits:{minInterval:0}});console.log(JSON.stringify({replay:result}));return result.paused||result.idle?30000:2000;}
 catch(e){console.error(JSON.stringify({replayError:e.message}));return 30000;}
}
async function snapshots(){
 const now=Date.now();
 if(now-lastExport>=Math.min(60,config.snapshotIntervalSeconds)*1000){exportSnapshot(db.sqlite,config.outputDir);lastExport=now;}
 if(config.publishRepo&&now-lastPublish>=config.publishIntervalSeconds*1000){lastPublish=now;try{console.log(JSON.stringify(await publish(config)));}catch(e){console.error(JSON.stringify({publishError:e.message}));}}
 return 3000;
}
try{await runConcurrentLoops([discovery,replay,snapshots],{controller});}
finally{exportSnapshot(db.sqlite,config.outputDir);server?.close();db.close();}

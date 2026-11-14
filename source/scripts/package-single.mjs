import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {addressBucket} from '../local/public-data.mjs';
const args=process.argv.slice(2),source=resolve(args[0]||process.env.HOME+'/.local/share/chainwatch/site'),target=resolve(args[1]||'output/index.html');
const manifest=JSON.parse(readFileSync(join(source,'data/manifest.json'),'utf8')),directory=JSON.parse(readFileSync(join(source,manifest.catalogPath,'directory.json'),'utf8')),payload={version:1,files:{},lookups:{}};
const encode=value=>gzipSync(Buffer.from(typeof value==='string'?value:JSON.stringify(value)),{level:9}).toString('base64');
payload.files['data/manifest.json']=encode(manifest);payload.files[manifest.catalogPath+'directory.json']=encode(directory);
const lookups=new Map();
for(const entity of directory.entities)for(const chunk of entity.files){
 const path=manifest.catalogPath+chunk.file,text=readFileSync(join(source,path),'utf8');payload.files[path]=encode(text);
 const part=Number(chunk.file.match(/-(\d+)\.json$/)[1]);
 for(const [index,row]of JSON.parse(text).entries()){const bucket=addressBucket(row.address);if(!bucket)continue;if(!lookups.has(bucket))lookups.set(bucket,[]);lookups.get(bucket).push([entity.id,part,index])}
}
for(const [bucket,entries]of lookups)payload.lookups[manifest.catalogPath+'lookup/'+bucket+'.json']=encode(entries);
for(const file of [...manifest.eventFiles,'progress.json']){const path=manifest.resultPath+file;payload.files[path]=encode(readFileSync(join(source,path),'utf8'))}
const js=readFileSync('pages-dist/assets/app.js','utf8').replace(/<\/script/gi,'<\\/script'),css=readFileSync('pages-dist/assets/app.css','utf8').replace(/<\/style/gi,'<\\/style');
const bootstrap=String.raw`(()=>{
 const node=document.getElementById('chainwatch-data'),data=JSON.parse(node.textContent);node.remove();const decoded=new Map(),base=new URL('./',document.baseURI);let signature,lastCheck=0;
 async function unzip(encoded){if(!globalThis.DecompressionStream)throw Error('This page requires a browser with gzip decompression support.');const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text())}
 async function entry(path){if(decoded.has(path))return decoded.get(path);const encoded=data.files[path]||data.lookups[path];if(!encoded)return null;let result=await unzip(encoded);
  if(data.lookups[path]){const prefix=path.slice(0,path.indexOf('lookup/')),rows=[];for(const [entity,chunk,index]of result){const file='entity-'+entity+'-'+chunk+'.json',records=await entry(prefix+file);rows.push([records[index].address,entity,file])}result=rows}
  decoded.set(path,result);if(decoded.size>8)decoded.delete(decoded.keys().next().value);return result;
 }
 async function checkForUpdate(){if(!/^https?:$/.test(location.protocol)||Date.now()-lastCheck<30000)return;lastCheck=Date.now();try{const r=await fetch(location.href,{method:'HEAD',cache:'no-cache'});const next=r.headers.get('etag')||r.headers.get('last-modified');if(signature&&next&&next!==signature)location.reload();if(next)signature=next}catch{}}
 globalThis.__CHAINWATCH_EMBEDDED_FETCH__=async input=>{const url=new URL(input,base);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return {ok:false,status:404};const path=decodeURIComponent(url.pathname.slice(base.pathname.length));if(path==='data/manifest.json')await checkForUpdate();const result=await entry(path);return result===null?{ok:false,status:404}:{ok:true,status:200,json:async()=>result}};
})()`;
const html='<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Public BTC/XBT institutional split observations, with sourced institution labels and transaction evidence."><title>Chainwatch | Public BTC &amp; XBT splits</title><style>'+css+'</style></head><body><div id="root"></div><script id="chainwatch-data" type="application/json">'+JSON.stringify(payload)+'</script><script>'+bootstrap+'</script><script type="module">'+js+'</script></body></html>';
if(Buffer.byteLength(html)>25*1024*1024)throw Error('Single file exceeds GitHub’s browser upload limit; use Git to upload it.');
mkdirSync(dirname(target),{recursive:true});writeFileSync(target,html);
console.log(JSON.stringify({file:target,bytes:Buffer.byteLength(html),sizeMiB:Number((Buffer.byteLength(html)/1048576).toFixed(2)),addresses:manifest.coverage.addresses,institutions:manifest.coverage.entities,observations:manifest.observationCount,snapshotTime:manifest.generatedAt}));

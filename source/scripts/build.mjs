import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const out=resolve('pages-dist');await mkdir(out+'/assets',{recursive:true});
await build({entryPoints:['pages/main.tsx'],bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',minify:true,outfile:out+'/assets/app.js',define:{'process.env.NODE_ENV':'"production"'},legalComments:'none'});
let html=await readFile('pages/index.html','utf8');
for(const name of ['app.js','app.css']){
 const version=createHash('sha256').update(await readFile(out+'/assets/'+name)).digest('hex').slice(0,16);
 html=html.replace('./assets/'+name,'./assets/'+name+'?v='+version);
}
await writeFile(out+'/index.html',html);await writeFile(out+'/.nojekyll','');console.log('Static dashboard built: '+out);

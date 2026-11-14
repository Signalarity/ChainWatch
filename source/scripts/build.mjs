import {build} from 'esbuild';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('pages-dist');await mkdir(out+'/assets',{recursive:true});
await build({entryPoints:['pages/main.tsx'],bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',minify:true,outfile:out+'/assets/app.js',define:{'process.env.NODE_ENV':'"production"'},legalComments:'none'});
await copyFile('pages/index.html',out+'/index.html');await writeFile(out+'/.nojekyll','');console.log('Static dashboard built: '+out);

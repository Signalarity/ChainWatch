import {mkdirSync,copyFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig} from '../local/config.mjs';
const args=process.argv.slice(2),i=args.indexOf('--config'),config=loadConfig(i>=0?args[i+1]:undefined);
for(const name of ['index.html','.nojekyll','assets/app.js','assets/app.css']){
 const source=join(config.projectRoot,'pages-dist',name),target=join(config.outputDir,name);
 mkdirSync(join(target,'..'),{recursive:true});copyFileSync(source,target+'.tmp');renameSync(target+'.tmp',target);
}
console.log('Updated dashboard assets; collector and saved data remain active.');

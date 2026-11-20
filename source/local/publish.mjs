import {spawn} from 'node:child_process';
import {mkdirSync,readdirSync,lstatSync,existsSync,writeFileSync,readFileSync,copyFileSync,statSync,utimesSync,rmSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,relative,dirname} from 'node:path';
import {projectRoot} from './database.mjs';
const sourceFiles=['package.json','package-lock.json','README.md','THIRD_PARTY_NOTICES.md','.gitignore'];
const sourceDirs=['app','lib','local','migrations','pages','scripts','tests','data'];
export async function git(args,{cwd,env={}}){return new Promise((resolve,reject)=>{const child=spawn('git',args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error('Git '+args[0]+' failed: '+err.slice(0,700))))})}
function files(root){const result=[];function visit(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Public export contains a symlink');const p=join(dir,entry.name);if(entry.isDirectory())visit(p);else if(entry.isFile())result.push(relative(root,p))}}visit(root);return result}
function sync(source,target,allow){mkdirSync(target,{recursive:true});const wanted=new Set(files(source).filter(allow));for(const name of files(target))if(!wanted.has(name))rmSync(join(target,name));for(const name of wanted){const from=join(source,name),to=join(target,name),s=statSync(from);if(existsSync(to)){const d=statSync(to);if(d.size===s.size&&Math.abs(d.mtimeMs-s.mtimeMs)<2)continue}mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);utimesSync(to,s.atime,s.mtime)}}
const publicFile=name=>name==='index.html'||name==='.nojekyll'||['assets/app.js','assets/app.css'].includes(name)||name==='data/manifest.json'||/^data\/catalog\/[a-f0-9]{24}\/(?:directory|entity-\d+-\d+|lookup\/(?:b-[a-z0-9]{2}|[13]-[A-Za-z0-9]{2}))\.json$/.test(name)||/^data\/results\/[a-f0-9]{24}\/(?:progress|events-\d+)\.json$/.test(name);
function publicationLock(root){
 const lock=join(root,'.publish-lock');
 for(let attempt=0;attempt<2;attempt++){
  try{mkdirSync(lock,{mode:0o700});writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid}));return lock;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   let owner;try{owner=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'));}catch{}
   if(Number.isInteger(owner?.pid)&&owner.pid>1){try{process.kill(owner.pid,0);return null;}catch(e){if(e.code!=='ESRCH')return null;}}
   else if(Date.now()-statSync(lock).mtimeMs<30000)return null;
   // Only the publisher's own stale lock directory is removed.
   rmSync(lock,{recursive:true,force:true});
  }
 }
 return null;
}
export async function publish(config,{includeSource=true}={}){
 if(!config.publishRepo)return {skipped:true,reason:'GitHub repository is not configured yet.'};
 const root=resolve(config.publicationDir),marker=join(root,'.chainwatch-publication');if([resolve('/'),resolve(projectRoot),resolve(config.outputDir)].includes(root))throw Error('Invalid dedicated publication directory');
 if(existsSync(root)&&!existsSync(marker)&&readdirSync(root).length)throw Error('Publication directory is not an empty dedicated checkout');
 mkdirSync(root,{recursive:true,mode:0o700});writeFileSync(marker,'Chainwatch generated publication checkout\n',{mode:0o600});
 const lock=publicationLock(root);if(!lock)return {busy:true};
 let frozen;
 try{
 // Freeze only allowlisted public files synchronously, before network awaits.
 // Independent scanning/export can now continue while this generation pushes.
 frozen=mkdtempSync(join(tmpdir(),'chainwatch-publication-'));sync(config.outputDir,frozen,publicFile);
 const env={GIT_INDEX_FILE:join(root,'.publish-index'),GIT_AUTHOR_NAME:'Chainwatch Publisher',GIT_AUTHOR_EMAIL:config.authorEmail||'Signalarity@users.noreply.github.com',GIT_COMMITTER_NAME:'Chainwatch Publisher',GIT_COMMITTER_EMAIL:config.authorEmail||'Signalarity@users.noreply.github.com',GIT_TERMINAL_PROMPT:'0'};
 if(config.sshKey){if(!config.knownHosts)throw Error('A pinned GitHub known-hosts file is required');env.GIT_SSH_COMMAND=`ssh -F /dev/null -i '${config.sshKey.replaceAll("'","'\\''")}' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='${config.knownHosts.replaceAll("'","'\\''")}'`}
 if(!existsSync(join(root,'.git')))await git(['init','--quiet'],{cwd:root});
 // Build each commit on the current remote head. A concurrent update rejects a normal
 // push; the next cycle fetches and rebuilds it. No force push or reset is used.
 const ref='refs/heads/'+(config.publishBranch||'main');if(!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref)||ref.includes('..'))throw Error('Invalid publishing branch');
 const remote=await git(['ls-remote',config.publishRepo,ref],{cwd:root,env});let parent;
 if(remote){await git(['fetch','--quiet','--no-tags',config.publishRepo,ref],{cwd:root,env});parent=await git(['rev-parse','FETCH_HEAD'],{cwd:root,env});await git(['read-tree',parent],{cwd:root,env})}else await git(['read-tree','--empty'],{cwd:root,env});
 sync(frozen,join(root,'docs'),publicFile);
 if(includeSource){const staged=join(root,'source');mkdirSync(staged,{recursive:true});for(const name of sourceFiles)if(existsSync(join(projectRoot,name)))copyFileSync(join(projectRoot,name),join(staged,name));for(const name of sourceDirs)sync(join(projectRoot,name),join(staged,name),f=>(name!=='data'||['seed.json','catalog-meta.json'].includes(f))&&!/(^|\/)(?:\.git|node_modules|\.state|output)(?:\/|$)/.test(f)&&!/(?:\.sqlite|\.key|\.pem|\.env|config\.local\.json)/.test(f))}
 writeFileSync(join(root,'README.md'),'# Chainwatch\n\nPublic BTC/XBT institutional coin-split observations. The publisher’s computer computes the results; GitHub Pages serves the dashboard.\n\nApplication source and setup instructions are in [source/README.md](source/README.md). Published files are under `docs/`.\n');
 const workflow=join(root,'.github/workflows/chainwatch-pages.yml');mkdirSync(dirname(workflow),{recursive:true});copyFileSync(join(projectRoot,'pages/chainwatch-pages.yml'),workflow);
 await git(['add','--all','--','docs','source','README.md','.github/workflows/chainwatch-pages.yml'],{cwd:root,env});const tree=await git(['write-tree'],{cwd:root,env});if(parent&&tree===await git(['rev-parse',parent+'^{tree}'],{cwd:root,env}))return {unchanged:true,commit:parent};
 const commit=await git(['commit-tree',tree,...(parent?['-p',parent]:[]),'-m','Update public Chainwatch results'],{cwd:root,env});
 await git(['push','--quiet',config.publishRepo,commit+':'+ref],{cwd:root,env});return {published:true,commit};
 }finally{if(frozen)rmSync(frozen,{recursive:true,force:true});rmSync(lock,{recursive:true,force:true})}
}

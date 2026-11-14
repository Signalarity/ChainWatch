import {mkdirSync,existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {projectRoot} from './database.mjs';
const home=homedir(),state=join(home,'.local/share/chainwatch'),configDir=join(home,'.config/chainwatch'),unitDir=join(home,'.config/systemd/user');
for(const path of [state,configDir,unitDir])mkdirSync(path,{recursive:true,mode:0o700});
const path=join(configDir,'config.json');let config=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};
config={stateDir:state,database:join(state,'collector.sqlite'),outputDir:join(state,'site'),publicationDir:join(state,'publication'),snapshotIntervalSeconds:600,publishIntervalSeconds:600,batchIntervalSeconds:2,previewPort:8794,sshKey:join(state,'github_publish_key'),knownHosts:join(state,'github_known_hosts'),...config};
if(!existsSync(config.sshKey)){const r=spawnSync('ssh-keygen',['-q','-t','ed25519','-N','','-C','Chainwatch repository publisher','-f',config.sshKey],{stdio:['ignore','pipe','pipe']});if(r.status!==0)throw Error('Could not generate the repository publishing key');}
chmodSync(config.sshKey,0o600);
if(!existsSync(config.knownHosts)){const r=await fetch('https://api.github.com/meta',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Could not retrieve GitHub’s official SSH host keys');const meta=await r.json();if(!Array.isArray(meta.ssh_keys)||!meta.ssh_keys.length)throw Error('GitHub did not return SSH host keys');writeFileSync(config.knownHosts,meta.ssh_keys.map(key=>'github.com '+key).join('\n')+'\n',{mode:0o600});}
writeFileSync(path,JSON.stringify(config,null,2)+'\n',{mode:0o600});chmodSync(path,0o600);
const quote=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
const unit=`[Unit]\nDescription=Chainwatch local collector and GitHub Pages publisher\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${projectRoot.replaceAll('%','%%')}\nExecStart=${quote(process.execPath)} ${quote(join(projectRoot,'local/run.mjs'))} --config ${quote(path)}\nEnvironment=PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin\nRestart=on-failure\nRestartSec=20\nTimeoutStopSec=90\nUMask=0077\nNice=10\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
writeFileSync(join(unitDir,'chainwatch-collector.service'),unit);
const desktop=join(home,'Desktop');if(existsSync(desktop)){const launcher=join(desktop,'Chainwatch.desktop');writeFileSync(launcher,'[Desktop Entry]\nType=Application\nName=Chainwatch Dashboard\nComment=View locally computed public BTC and XBT observations\nExec=xdg-open http://127.0.0.1:8794/\nIcon=applications-internet\nTerminal=false\nCategories=Network;\n');chmodSync(launcher,0o755)}
console.log(JSON.stringify({config:path,unit:join(unitDir,'chainwatch-collector.service'),publicKey:config.sshKey+'.pub',preview:'http://127.0.0.1:8794/'}));

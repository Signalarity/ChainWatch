import {homedir} from 'node:os';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {projectRoot} from './database.mjs';
export function loadConfig(file){
 const base=join(homedir(),'.local/share/chainwatch'),config=file?JSON.parse(readFileSync(file,'utf8')):{};
 const settings={stateDir:base,database:join(base,'collector.sqlite'),outputDir:join(base,'site'),publicationDir:join(base,'publication'),snapshotIntervalSeconds:600,publishIntervalSeconds:600,batchIntervalSeconds:2,previewPort:8794,...config};
 for(const key of ['stateDir','database','outputDir','publicationDir'])settings[key]=resolve(settings[key]);
 if(!Number.isInteger(settings.previewPort)||settings.previewPort<1024||settings.previewPort>65535)throw Error('Invalid preview port');
 if(settings.publishRepo&&!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$|^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(settings.publishRepo))throw Error('Use a GitHub repository URL');
 return {...settings,projectRoot};
}

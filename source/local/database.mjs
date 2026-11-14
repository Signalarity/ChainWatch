import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export function openDatabase(filename){
 mkdirSync(dirname(resolve(filename)),{recursive:true,mode:0o700});
 const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000; PRAGMA foreign_keys=ON');
 sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL)');
 for(const name of readdirSync(resolve(projectRoot,'migrations')).filter(f=>f.endsWith('.sql')).sort()){
  const sql=readFileSync(resolve(projectRoot,'migrations',name),'utf8'),hash=createHash('sha256').update(sql).digest('hex');
  const previous=sqlite.prepare('SELECT sha256 FROM local_migrations WHERE name=?').get(name);
  if(previous){if(previous.sha256!==hash)throw Error('An applied migration changed: '+name);continue}
  sqlite.exec('BEGIN IMMEDIATE');try{sqlite.exec(sql);sqlite.prepare('INSERT INTO local_migrations(name,sha256) VALUES (?,?)').run(name,hash);sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}
 }
 const d1={prepare(sql){let values=[];const command={bind(...args){values=args;return command},async first(){return sqlite.prepare(sql).get(...values)||null},async all(){return {results:sqlite.prepare(sql).all(...values)}},async run(){const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}}},_execute(){const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}}}};return command},async batch(commands){sqlite.exec('BEGIN IMMEDIATE');try{const result=commands.map(c=>c._execute());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 return {sqlite,d1,close(){sqlite.close()}};
}

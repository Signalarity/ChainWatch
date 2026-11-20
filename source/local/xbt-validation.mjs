import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {FORK,FORK_HASH} from '../lib/evidence.mjs';
const exec=promisify(execFile);
// Only these read-only RPC methods can reach the CLI. Never sendrawtransaction.
export function createXbtValidator(config={},injected){
 const cli=config.xbtValidationCli||join(homedir(),'xbt-knots-29.5/bitcoin-29.5.knots20260508/bin/bitcoin-cli');
 const datadir=config.xbtValidationDatadir||join(homedir(),'.bitcoin');
 if(!injected&&!existsSync(cli))return undefined;
 const rpc=injected||async function(method,...args){
  if(!['getblockchaininfo','getblockhash','testmempoolaccept'].includes(method))throw Error('Read-only RPC method required.');
  const {stdout}=await exec(cli,['-datadir='+datadir,'-rpcconnect=127.0.0.1','-rpcclienttimeout=8',method,...args],{timeout:10000,maxBuffer:2000000});
  try{return JSON.parse(stdout)}catch{return stdout.trim()}
 };
 let verifiedUntil=0;
 return async(hex,txid)=>{
  try{
   if(Date.now()>verifiedUntil){
    const info=await rpc('getblockchaininfo');
    if(info.chain!=='main'||info.initialblockdownload||info.blocks!==info.headers||!info.difficulty_blake2b)return {unavailable:true};
    if(await rpc('getblockhash',String(FORK))!==FORK_HASH)return {unavailable:true};
    verifiedUntil=Date.now()+60000;
   }
   // maxfeerate=0 avoids rejecting a replay solely for the caller's fee cap.
   const rows=await rpc('testmempoolaccept',JSON.stringify([hex]),'0');
   const r=rows?.[0];if(!r||r.txid!==txid)return {unavailable:true};
   const reason=String(r['reject-reason']||r['package-error']||'').slice(0,250);
   if(/already.in.mempool|already.known/.test(reason))return {seen:true};
   return typeof r.allowed==='boolean'?{allowed:r.allowed,reason}:{unavailable:true};
  }catch{return {unavailable:true};} // Never export CLI stderr, cookie paths or credentials.
 };
}

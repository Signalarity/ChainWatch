export const START = 1788220800; // September 1, 2026 00:00 UTC
export const FORK = 961640;
export const FORK_HASH = '0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb';
export const SHARED_HEIGHT = 961631;
export const SHARED_HASH = '00000000000000000000807f9dc917442a67910426d79ebb2f8aa2149327ce8a';
export const confirmations = (status,tip) => status?.confirmed && Number.isInteger(status.block_height) ? Math.max(0,tip-status.block_height+1) : 0;
export function opcodes(hex) {
 if(typeof hex!=='string'||hex.length%2||!/^[0-9a-f]*$/i.test(hex)) return null;
 const b=Uint8Array.from(hex.match(/../g)||[],x=>parseInt(x,16)), ops=[];
 for(let i=0;i<b.length;) {const op=b[i++];let n=op;
  if(op>78){ops.push({op,data:null});continue}
  if(op>=76){const bytes=op===76?1:op===77?2:4;if(i+bytes>b.length)return null;n=0;for(let j=0;j<bytes;j++)n+=b[i++] * 2**(j*8);}
  if(i+n>b.length)return null;ops.push({op,data:Array.from(b.slice(i,i+n)).map(x=>x.toString(16).padStart(2,'0')).join('')});i+=n;
 }return ops;
}
export function inscriptionSignal(input) {
 if(input.prevout?.scriptpubkey_type!=='v1_p2tr')return false;
 const w=[...(input.witness||[])];if(w.length>=2&&w.at(-1)?.startsWith('50'))w.pop();
 if(w.length<2||!/^c[01]/i.test(w.at(-1))||((w.at(-1).length/2-33)%32)!==0)return false;
 const ops=opcodes(w.at(-2));return !!ops?.some((o,i)=>o.op===0&&ops[i+1]?.op===99&&ops[i+2]?.data==='6f7264');
}
export function signatureSignal(input) {
 // An indicator only: stack data can resemble a signature without being executed.
 return (input.witness||[]).some(s=>typeof s==='string'&&((s.length===130&&[0x21,0x22,0x23,0xa1,0xa2,0xa3].includes(parseInt(s.slice(-2),16)))||(s.startsWith('30')&&s.length>=18&&s.length<=146&&(parseInt(s.slice(-2),16)&0x20)!==0)));
}
export function classify({btc,xbt,btcTip,xbtTip}) {
 if(!btc||!xbt||typeof btc.spent!=='boolean'||typeof xbt.spent!=='boolean')return {status:'unknown',detail:'Explorer data unavailable or incomplete.'};
 const bc=confirmations(btc.status,btcTip),xc=confirmations(xbt.status,xbtTip);
 if(btc.spent&&xbt.spent){
  if(!btc.txid||!xbt.txid)return {status:'unknown',detail:'Missing spending transaction.'};
  if(btc.txid===xbt.txid)return {status:'replayed',detail:'The same original output has the same spending transaction on both explorers.'};
  if(bc>=6&&xc>=6)return {status:'split',detail:'The same pre-fork output has different spending transactions with at least six confirmations on each chain. Explorer-reported evidence; intent is unknown.'};
  return {status:'pending',detail:'Different spends observed; waiting for six confirmations on each chain.'};
 }
 if(btc.spent)return {status:'btc_only',detail:'One-sided observation: the original output was spent on BTC and remains unspent on XBT at the last check.'};
 if(xbt.spent)return {status:'xbt_only',detail:'One-sided observation: the original output was spent on XBT and remains unspent on BTC at the last check.'};
 return {status:'unspent',detail:'Original output remains unspent on both explorers.'};
}
export function aggregateSplits(rows,start=START,end=Infinity) {
 const groups=new Map();
 for(const r of rows){if(r.status!=='split'||r.time<start||r.time>=end)continue;const key=r.btc_tx+':'+r.xbt_tx;
  if(!groups.has(key))groups.set(key,{id:key,btc_tx:r.btc_tx,xbt_tx:r.xbt_tx,value:0,time:r.time,entities:[],inputs:0});
  const g=groups.get(key);g.value+=r.value;g.inputs++;g.time=Math.max(g.time,r.time);if(!g.entities.includes(r.entity))g.entities.push(r.entity);
 }return [...groups.values()].sort((a,b)=>b.value-a.value).slice(0,10);
}
export function requiredUnifiedSignature(input) {
 const type=input.prevout?.scriptpubkey_type,w=[...(input.witness||[])];
 const hasFlag=(s)=>typeof s==='string'&&(parseInt(s.slice(-2),16)&0x20)!==0;
 const der=(s)=>typeof s==='string'&&/^30[0-9a-f]+$/i.test(s)&&s.length>=18&&s.length<=146&&parseInt(s.slice(2,4),16)===(s.length/2-3)&&hasFlag(s);
 if(type==='v0_p2wpkh')return w.length===2&&der(w[0])&&/^(02|03)[a-f0-9]{64}$/i.test(w[1]);
 if(type==='p2pkh'){const ops=opcodes(input.scriptsig||'');return !!(ops&&ops.length===2&&der(ops[0].data)&&/^(02|03)[a-f0-9]{64}$/i.test(ops[1].data||''));}
 if(type==='v1_p2tr'){if(w.length>=2&&w.at(-1)?.startsWith('50'))w.pop();return w.length===1&&w[0].length===130&&[0x21,0x22,0x23,0xa1,0xa2,0xa3].includes(parseInt(w[0].slice(-2),16));}
 return false; // General scripts require execution; do not guess.
}

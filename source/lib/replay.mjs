import {requiredUnifiedSignature,inscriptionSignal,confirmations} from './evidence.mjs';
export const REPLAY_LABELS={
 different_spends:'Confirmed different spends',xbt_opt_in:'XBT opt-in protection observed',
 node_accepted:'Replayable · XBT node accepted',node_rejected:'XBT node rejected · see reason',
 input_conflict:'Input spent differently on XBT',missing_ancestor:'Missing XBT funding transaction',
 btc_input_conflict:'Input spent differently on BTC',btc_missing_ancestor:'Missing BTC funding transaction',
 btc_input_pending:'Input conflict pending on BTC',btc_inputs_available:'No BTC input blocker · validity unverified',
 seen_on_btc:'Transaction seen on BTC · recheck observation',
 input_pending:'Input conflict pending on XBT',inputs_available:'No input blocker found · validity unverified',
 seen_on_xbt:'Transaction seen on XBT · recheck observation',incomplete:'Replay check incomplete',
 unavailable:'Replay check unavailable',not_checked:'Replay check pending'
};
export const replayLabel=state=>REPLAY_LABELS[state]||REPLAY_LABELS.not_checked;
export function replayFields(row,assessment){
 if(row.status==='split')return {replay_state:'different_spends',replay_detail:'Different spending transactions confirmed at least six times on both chains. This establishes divergence, not intent or permanent protection.',replay_checked:row.checked};
 if(row.status==='protected')return {replay_state:'xbt_opt_in',replay_detail:'Confirmed XBT spend uses an opt-in signature in a recognized standard signature position; original BTC output reported unspent.',replay_checked:row.checked};
 if(['btc_only','xbt_only'].includes(row.status)&&assessment)return {replay_state:assessment.state,replay_detail:assessment.detail,replay_checked:assessment.checked};
 return {replay_state:'not_checked',replay_detail:'Queued for a replay assessment. One-sided spending alone does not establish replay protection.',replay_checked:null};
}
export function replaySummary(rows){return {
 confirmedSplitValue:rows.filter(r=>r.status==='split').reduce((n,r)=>n+r.value,0),
 oneSidedValue:rows.filter(r=>r.status!=='split').reduce((n,r)=>n+r.value,0),
 replayableValue:rows.filter(r=>r.status==='btc_only'&&r.replay_state==='node_accepted').reduce((n,r)=>n+r.value,0),
 replayPending:rows.filter(r=>['btc_only','xbt_only'].includes(r.status)&&(!r.replay_state||['not_checked','incomplete','unavailable'].includes(r.replay_state))).length
};}
function dataHint(tx){
 const oversized=(tx.vout||[]).filter(o=>typeof o.scriptpubkey==='string'&&o.scriptpubkey.length/2>(o.scriptpubkey.startsWith('6a')?83:34));
 const inscriptions=(tx.vin||[]).filter(inscriptionSignal).length;
 return (oversized.length?` ${oversized.length} output script(s) exceed XBT's reduced-data size thresholds (83 bytes for OP_RETURN, 34 otherwise); activation and input exemptions require node validation.`:'')+(inscriptions?` ${inscriptions} parsed inscription envelope(s) were observed; a pattern alone is not a consensus verdict.`:'');
}
export function assessBtcReplay(session,tx,{xbtTip,validate}={}){
 return assessReplay(session,tx,{source:'btc',targetTip:xbtTip,validate});
}
export async function assessReplay(session,tx,{source='btc',targetTip,sourceConfs=0,validate}={}){
 const target=source==='btc'?'xbt':'btc',SRC=source.toUpperCase(),DST=target.toUpperCase();
 const targetState=code=>source==='btc'?code:({input_conflict:'btc_input_conflict',missing_ancestor:'btc_missing_ancestor',input_pending:'btc_input_pending',inputs_available:'btc_inputs_available',seen_on_xbt:'seen_on_btc'}[code]||code);
 if(!tx||!Array.isArray(tx.vin)||!tx.vin.length||!Array.isArray(tx.vout))return {state:'unavailable',detail:`Complete ${SRC} transaction body unavailable.`};
 if(source==='xbt'&&sourceConfs>=6&&tx.vin.some(requiredUnifiedSignature))return {state:'xbt_opt_in',detail:'The confirmed XBT transaction uses SIGHASH_UNIFIED in a recognized standard signature position. That input signature commits to the XBT opt-in digest and cannot be replayed unchanged on BTC.'};
 const hint=source==='btc'?dataHint(tx):'';let node;
 if(validate&&source==='btc'){
  const hex=await session.get(source,`/tx/${tx.txid}/hex`,true);
  if(typeof hex==='string'&&/^(?:[a-f0-9]{2})+$/i.test(hex))node=await validate(hex,tx.txid);
  if(node?.allowed===true)return {state:'node_accepted',detail:'The synchronized, checkpoint-verified local XBT node accepted the exact BTC transaction in testmempoolaccept. All inputs and scripts passed that node’s current mempool checks. No broadcast was performed; validity can change after this check.'};
  if(node?.seen)return {state:'seen_on_xbt',detail:'The local XBT node reports this transaction already known or in its mempool. The original one-sided observation needs rechecking.'};
 }
 // Find a concrete conflicting input or a missing dependency. A missing parent
 // might itself replay later: never describe it as permanent protection.
 let unconfirmed=false;
 for(const input of tx.vin){
  if(!/^[a-f0-9]{64}$/.test(input.txid||'')||!Number.isInteger(input.vout)||input.vout<0)return {state:'unavailable',detail:`${SRC} input reference unavailable.`};
  const parent=await session.tx(target,input.txid);
  if(!parent)return {state:targetState('missing_ancestor'),detail:`${DST} explorer did not find the funding transaction for ${input.txid}:${input.vout}. The exact ${SRC} spend lacks a dependency on ${DST} now; replaying ancestors could change that. Other inputs may have additional blockers.${node?.reason?' Local XBT node: '+node.reason+'.':''}${hint}`};
  if(!parent.status?.confirmed){unconfirmed=true;continue;}
  if(await session.get(target,`/block-height/${parent.status.block_height}`)!==parent.status.block_hash)throw Error(`${DST} funding block changed during replay assessment.`);
  const prev=parent.vout?.[input.vout];if(!prev)return {state:'unavailable',detail:`Referenced ${DST} funding output unavailable.`};
  if(input.prevout&&(prev.value!==input.prevout.value||prev.scriptpubkey!==input.prevout.scriptpubkey))return {state:'unavailable',detail:'BTC and XBT funding output data disagree.'};
  const spent=await session.get(target,`/tx/${input.txid}/outspend/${input.vout}`,true);
  if(!spent||typeof spent.spent!=='boolean')throw Error(`${DST} input spending information unavailable.`);
  if(spent.spent){
   if(spent.txid===tx.txid)return {state:targetState('seen_on_xbt'),detail:`An input is reported spent by the ${SRC} transaction on ${DST}; recheck the one-sided observation.`};
   if(!/^[a-f0-9]{64}$/.test(spent.txid||''))throw Error(`Conflicting ${DST} transaction identifier unavailable.`);
   if(confirmations(spent.status,targetTip)>=6){
    if(await session.get(target,`/block-height/${spent.status.block_height}`)!==spent.status.block_hash)throw Error(`Conflicting ${DST} spend block changed.`);
    const other=await session.tx(target,spent.txid);
    if(!other?.vin?.some(v=>v.txid===input.txid&&v.vout===input.vout)||other.status?.block_hash!==spent.status.block_hash||!other.status?.confirmed)throw Error(`Conflicting ${DST} spend could not be verified.`);
    return {state:targetState('input_conflict'),detail:`Input ${input.txid}:${input.vout} was spent by a different ${DST} transaction (${spent.txid}) with at least six confirmations. The exact ${SRC} transaction cannot currently replay against that spent input. Reorgs can change this.`};
   }
   unconfirmed=true;
  }
 }
 if(unconfirmed)return {state:targetState('input_pending'),detail:`At least one ${DST} funding transaction or conflicting spend is unconfirmed or has fewer than six confirmations. Replay status is not settled.`};
 if(node?.allowed===false)return {state:'node_rejected',detail:`The local XBT node rejected the BTC transaction: ${node.reason||'reason unavailable'}. An input conflict was not established. Rejection may be policy, fee, timing, or consensus related; it does not alone prove permanent replay protection.${hint}`};
 return {state:targetState('inputs_available'),detail:`All referenced outputs were found confirmed and reported unspent on ${DST}, but full transaction validity was not established by a local node. Absence of a blocker is not proof of replayability.${hint}`};
}

export function checkerProgress(rows){
 const byTx=new Map();
 for(const row of rows){
  const key=row.status==='split'?'pair:'+row.btc_tx+':'+row.xbt_tx:row.status==='btc_only'?'btc:'+row.btc_tx:'xbt:'+row.xbt_tx;
  const state=row.replay_state||'not_checked',previous=byTx.get(key);
  if(!previous||previous==='not_checked'||state==='xbt_opt_in')byTx.set(key,state);
 }
 const states={};for(const state of byTx.values())states[state]=(states[state]||0)+1;
 const pending=(states.not_checked||0)+(states.incomplete||0)+(states.unavailable||0);
 return {total:byTx.size,assessed:byTx.size-pending,pending,states};
}

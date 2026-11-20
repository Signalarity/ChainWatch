// Use verified observation statuses; missing transaction IDs alone are not evidence.
export function stayedLabel(status){
 if(status==='btc_only')return 'XBT stayed (unspent)';
 if(status==='xbt_only'||status==='protected')return 'BTC stayed (unspent)';
 if(status==='split')return 'Neither · both spent';
 return 'Not established';
}
export function stayedCounts(counts){
 const result={btc:0,xbt:0};
 for(const row of counts){
  if(row.status==='btc_only')result.xbt+=row.count;
  if(row.status==='xbt_only'||row.status==='protected')result.btc+=row.count;
 }
 return result;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {stayedLabel,stayedCounts} from '../lib/stayed.mjs';
test('stayed labels identify the unspent chain without inferring retention for unknown evidence',()=>{
 assert.equal(stayedLabel('btc_only'),'XBT stayed (unspent)');
 assert.equal(stayedLabel('xbt_only'),'BTC stayed (unspent)');
 assert.equal(stayedLabel('protected'),'BTC stayed (unspent)');
 assert.equal(stayedLabel('split'),'Neither · both spent');
 for(const status of ['pending','replayed','',undefined])assert.equal(stayedLabel(status),'Not established');
});
test('BTC stayed includes protected XBT spends; divergent spends count toward neither chain',()=>{
 assert.deepEqual(stayedCounts([{status:'btc_only',count:4},{status:'xbt_only',count:2},{status:'protected',count:3},{status:'split',count:10}]),{btc:5,xbt:4});
 assert.deepEqual(stayedCounts([]),{btc:0,xbt:0});
});

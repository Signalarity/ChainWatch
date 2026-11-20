import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestGate} from '../lib/request-gate.mjs';
import {runConcurrentLoops} from '../local/loops.mjs';
test('replay loop runs while discovery is waiting, and shutdown drains in-flight work',async()=>{
 const controller=new AbortController(),events=[];let release;
 const slow=new Promise(resolve=>release=resolve);
 await runConcurrentLoops([
  async()=>{events.push('discovery started');await slow;events.push('discovery finished');return 1000;},
  async()=>{assert.deepEqual(events,['discovery started']);events.push('checker ran');release();controller.abort();return 1000;}
 ],{controller});
 assert.deepEqual(events,['discovery started','checker ran','discovery finished']);
});
test('discovery and checker share a paced global cap of two requests',async()=>{
 let now=0,active=0,max=0;const starts=[];
 const gate=createRequestGate(async()=>{starts.push(now);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return true},{clock:()=>now,sleep:async ms=>{now+=ms},minInterval:5,maxConcurrent:2});
 await Promise.all(Array.from({length:8},()=>gate()));assert.equal(max,2);assert.equal(starts.length,8);for(let n=1;n<starts.length;n++)assert.ok(starts[n]-starts[n-1]>=5);
});
test('a shared cooldown refusal releases the queue without starting an explorer request',async()=>{
 let guards=0,requests=0;const gate=createRequestGate(async()=>{requests++;return true},{minInterval:0,beforeRequest(){if(++guards===1)throw Error('cooldown')}});
 const results=await Promise.allSettled([gate(),gate()]);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(requests,1);
});

// Shared by discovery and replay checking: two requests in flight across both
// workers, with paced starts. Each worker retains its own bounded work budget.
export function createRequestGate(remote,{minInterval=500,maxConcurrent=2,beforeRequest=()=>{},clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 let gate=Promise.resolve(),active=0,lastStart=-Infinity;const waiters=[];
 return async(...args)=>{
  const previous=gate;let release;gate=new Promise(r=>release=r);await previous;
  try{
   if(active>=maxConcurrent)await new Promise(resolve=>waiters.push(resolve));
   const delay=Math.max(0,lastStart+minInterval-clock());if(delay)await sleep(delay);
   await beforeRequest();lastStart=clock();active++;
  }finally{release();}
  try{return await remote(...args)}finally{active--;waiters.shift()?.();}
 };
}

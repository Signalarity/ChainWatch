// Each step owns its own cadence. One slow network batch does not hold up the
// other steps. Shutdown wakes timers, then waits for in-flight bounded work.
export async function runConcurrentLoops(steps,{controller=new AbortController()}={}){
 const waits=new Set();
 const wake=()=>{for(const done of [...waits])done()};
 controller.signal.addEventListener('abort',wake);
 const sleep=ms=>new Promise(resolve=>{
  let timer;const done=()=>{clearTimeout(timer);waits.delete(done);resolve()};
  waits.add(done);timer=setTimeout(done,ms);if(controller.signal.aborted)done();
 });
 const jobs=steps.map(async step=>{try{while(!controller.signal.aborted){const delay=await step();if(!controller.signal.aborted)await sleep(Math.max(1,delay||1));}}catch(error){controller.abort();throw error;}});
 try{const results=await Promise.allSettled(jobs);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}
 finally{controller.signal.removeEventListener('abort',wake);wake();}
}

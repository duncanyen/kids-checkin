// One-shot DOM animation follows the supplied manifest, without coupling grants to frames.
export function playChestFrames(manifest,{frame,reveal,finish,schedule=setTimeout,cancel=clearTimeout}){
    const timers=[];let stopped=false,revealed=false;
    const showResult=()=>{if(!revealed){revealed=true;reveal();}};
    let elapsed=0;
    for(const item of manifest.frames){
        const run=()=>{if(stopped)return;frame(item);if(item.index===manifest.reveal_frame)showResult();};
        if(!elapsed)run();else timers.push(schedule(run,elapsed));
        elapsed+=item.duration_ms;
    }
    timers.push(schedule(()=>{if(stopped)return;showResult();finish();},elapsed));
    const stop=()=>{stopped=true;timers.forEach(cancel);};
    return{stop,skip(){if(stopped)return;stop();frame(manifest.frames.find(f=>f.index===manifest.hold_frame));showResult();finish();}};
}

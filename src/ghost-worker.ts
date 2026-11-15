import { importReplay, type Replay } from './replay';
import { replayCheckpointTimes } from './playback';
import { challengeCheckpoints } from './challenges';
import type { GhostFrame } from './ghost';

self.onmessage = async event => {
 try {
  let sent=false;
  const send=(replay:Replay,frames:GhostFrame[])=>{
   if(replay.challenge!==event.data.challenge)throw Error('Ghost 回放与当前关卡不一致');
   const known=replay.recording.checkpointTimes;
   self.postMessage({definition:!sent?replay.definition:undefined,frames,
    checkpointTimes:!sent?challengeCheckpoints(replay.challenge).map((_,i)=>known?.[i]??null):undefined,
    timingReady:replay.challenge!=='downhill'||known!==undefined},
    {transfer:[...new Set(frames.flatMap(f=>[f.sections.buffer,f.fragments.buffer]))]});
   sent=true;
  };
  const replay=await importReplay(event.data.text,'ghost',send);
  if(!sent)send(replay,replay.recording.ghostFrames!);
  const known=replay.recording.checkpointTimes;
  const timingReady=replay.challenge!=='downhill'||known!==undefined;
  // Older files have sparse physics keyframes. Derive exact splits after their visual track is ready.
  if(!timingReady)self.postMessage({checkpointTimes:await replayCheckpointTimes(replay),timingReady:true});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
 finally{self.close();}
};

import { GHOST_SECTION_WIDTH, ghostFrameBytes, MAX_GHOST_TRACK_BYTES, type GhostFrame } from './ghost';

const HEADER = 22;
function fail(): never { throw Error('Ghost 回放状态无效'); }

/** Binary visual samples avoid parsing a second large JSON physics graph. */
export async function encodeGhostFrames(frames: GhostFrame[]): Promise<string> {
 const length=1+frames.reduce((sum,f)=>sum+ghostFrameBytes(f)/8,0), data=new Float64Array(length);
 data[0]=frames.length;let offset=1;
 for(const f of frames){
  data.set([f.time,f.flightTime,+f.ended,+f.done,...f.position,...f.quaternion,...f.cg,...f.pilot,...f.controls,f.thrust,f.sections.length,f.fragments.length],offset);offset+=HEADER;
  data.set(f.sections,offset);offset+=f.sections.length;data.set(f.fragments,offset);offset+=f.fragments.length;
 }
 const bytes=new Uint8Array(await new Response(new Blob([data.buffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(binary);
}

export async function decodeGhostFrames(encoded: unknown, duration: number, sections: number, maxFrames: number): Promise<GhostFrame[]> {
 if(typeof encoded!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail();
 let bytes: Uint8Array;
 try{
  const compressed=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_GHOST_TRACK_BYTES+1024*1024){await reader.cancel();fail();}chunks.push(value);}
  bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 }catch{fail();}
 if(bytes.byteLength%8)fail();
 const data=new Float64Array(bytes.buffer),count=data[0],frames:GhostFrame[]=[];
 if(!Number.isInteger(count)||count<2||count>maxFrames+1||data.some(n=>!Number.isFinite(n)||Math.abs(n)>1e9))fail();
 let offset=1;
 for(let i=0;i<count;i++){
  if(offset+HEADER>data.length)fail();const h=data.subarray(offset,offset+HEADER);offset+=HEADER;
  const sectionLength=h[20],fragmentLength=h[21];
  if(sectionLength!==sections*GHOST_SECTION_WIDTH||!Number.isInteger(fragmentLength)||fragmentLength<0||fragmentLength%11||fragmentLength>sections*11||offset+sectionLength+fragmentLength>data.length)fail();
  if(h[0]<0||i===0&&h[0]!==0||i>0&&h[0]<=frames[i-1].time||h[1]<0||![0,1].includes(h[2])||h[3]!==+(i===count-1))fail();
  const sectionData=data.subarray(offset,offset+sectionLength);offset+=sectionLength;const fragmentData=data.subarray(offset,offset+fragmentLength);offset+=fragmentLength;
  for(let j=0;j<sectionLength;j+=GHOST_SECTION_WIDTH)if(!Number.isInteger(sectionData[j])||sectionData[j]<0||sectionData[j]>sections)fail();
  const ids=new Set<number>();for(let j=0;j<fragmentLength;j+=11){const id=fragmentData[j];if(!Number.isInteger(id)||id<1||id>sections||ids.has(id))fail();ids.add(id);}
  const quaternion=Array.from(h.subarray(7,11));if(Math.abs(quaternion.reduce((sum,n)=>sum+n*n,0)-1)>0.01)fail();
  frames.push({time:h[0],flightTime:h[1],ended:!!h[2],done:!!h[3],position:Array.from(h.subarray(4,7)),quaternion,cg:Array.from(h.subarray(11,14)),pilot:Array.from(h.subarray(14,16)),controls:Array.from(h.subarray(16,19)),thrust:h[19],sections:sectionData,fragments:fragmentData});
 }
 if(offset!==data.length||Math.abs(frames.at(-1)!.time-duration)>1e-8)fail();
 return frames;
}

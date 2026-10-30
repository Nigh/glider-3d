<script lang="ts">
 import { clone, clamp, planform, type Wing } from './model';
 let { value, vertical=false, onchange, oncommit }:{value:Wing;vertical?:boolean;onchange:(v:Wing)=>void;oncommit:()=>void}=$props();
 let svg:SVGSVGElement; let dragging=$state(-1);let error=$state('');
 const sx=22, sy=17, ox=60,oy=165;
 let metrics=$derived(planform(value,!vertical));
 function begin(e:PointerEvent){const matrix=svg.getScreenCTM();if(!matrix)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());let nearest=-1,distance=22*22;for(let i=0;i<4;i++){const p=value.points[i],d=(ox+p.y*sx-point.x)**2+(oy-p.x*sy-point.y)**2;if(d<distance){nearest=i;distance=d;}}if(nearest>=0){e.preventDefault();dragging=nearest;svg.setPointerCapture(e.pointerId);}}
 function move(e:PointerEvent){if(dragging<0)return;const matrix=svg.getScreenCTM();if(!matrix)return;const {x,y}=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());const w=clone(value),i=dragging;error='';
 w.points[i].x=clamp((oy-y)/sy,-3,6);
 if(i===1||i===2){const span=clamp((x-ox)/sx,0.25,12);w.points[1].y=span;w.points[2].y=span;}
 if(i===0)w.points[0].x=Math.min(w.points[0].x,w.points[3].x-0.15);
 if(i===3)w.points[3].x=Math.max(w.points[3].x,w.points[0].x+0.15);
 if(i===1)w.points[1].x=Math.min(w.points[1].x,w.points[2].x-0.15);
 if(i===2)w.points[2].x=Math.max(w.points[2].x,w.points[1].x+0.15);
 onchange(w);}
 function end(){if(dragging>=0){dragging=-1;oncommit();}}
 function numeric(i:number,key:'x'|'y',input:HTMLInputElement){const w=clone(value),n=input.valueAsNumber;error='';if(!Number.isFinite(n)){error='请输入有限数值，已恢复原值。';input.value=String(value.points[i][key]);return;}if(key==='y'){w.points[1].y=w.points[2].y=clamp(n,0.25,12);}else{w.points[i].x=clamp(n,-3,6);if(w.points[3].x-w.points[0].x<0.15||w.points[2].x-w.points[1].x<0.15){error='根弦与梢弦至少 0.15 m，已恢复原值。';input.value=String(value.points[i][key]);return;}}input.value=String(w.points[i][key]);onchange(w);oncommit();}
</script>
<div class="planform-editor">
 <svg bind:this={svg} viewBox="0 0 340 200" aria-label={vertical?'垂直尾翼四边形编辑器':'翼面四边形编辑器'} onpointerdown={begin} onpointermove={move} onpointerup={end} onpointercancel={end} role="img">
 <defs><pattern id="grid" width="22" height="17" patternUnits="userSpaceOnUse"><path d="M 22 0 L 0 0 0 17" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.13"/></pattern></defs>
 <rect width="340" height="200" fill="url(#grid)"/>
 <line x1={ox} y1="15" x2={ox} y2="185" stroke="currentColor" stroke-dasharray="3 5" opacity="0.4"/>
 <polygon points={value.points.map(p=>`${ox+p.y*sx},${oy-p.x*sy}`).join(' ')} fill="var(--accent)" fill-opacity="0.16" stroke="var(--accent)" stroke-width="2"/>
 {#each value.points as p,i}<g><circle cx={ox+p.y*sx} cy={oy-p.x*sy} r="17" fill="transparent" role="presentation"/><circle cx={ox+p.y*sx} cy={oy-p.x*sy} r="6" fill="var(--panel)" stroke="var(--accent)" stroke-width="2" pointer-events="none"/><text x={ox+p.y*sx+10} y={oy-p.x*sy-10} font-size="10" fill="currentColor" pointer-events="none">{i+1}</text></g>{/each}
 <text x="10" y="20" font-size="11" fill="currentColor" opacity="0.65">机头方向 ↑</text><text x="170" y="190" font-size="11" fill="currentColor" opacity="0.65">{vertical?'高度':'半翼展'} / m</text>
 </svg>
 <div class="wing-stats"><span>{metrics.span.toFixed(2)}<small>{vertical?'高度':'翼展'} m</small></span><span>{metrics.area.toFixed(2)}<small>面积 m²</small></span><span>{metrics.aspect.toFixed(1)}<small>展弦比</small></span></div>
 <details><summary>精确编辑四个顶点</summary><div class="point-table"><span>顶点</span><span>后向 x / m</span><span>{vertical?'高度':'半展'} / m</span>{#each value.points as p,i}<label for={`px${i}`}>{['翼根前缘','翼梢前缘','翼梢后缘','翼根后缘'][i]}</label><input id={`px${i}`} aria-label={`顶点${i+1}后向坐标`} type="number" min="-3" max="6" step="0.05" value={p.x} onchange={(e)=>numeric(i,'x',e.currentTarget)}/><input aria-label={`顶点${i+1}展向坐标`} type="number" min="0.25" max="12" step="0.05" value={p.y} disabled={i===0||i===3} onchange={(e)=>numeric(i,'y',e.currentTarget)}/>{/each}</div>{#if error}<p role="alert" class="field-error">{error}</p>{/if}</details>
</div>

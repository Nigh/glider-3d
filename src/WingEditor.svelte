<script lang="ts">
 import { clone, clamp, planform, type Wing } from './model';
 let { value, vertical=false, onchange, oncommit }:{value:Wing;vertical?:boolean;onchange:(v:Wing)=>void;oncommit:()=>void}=$props();
 let error=$state('');
 let metrics=$derived(planform(value,!vertical));
 function numeric(i:number,key:'x'|'y',input:HTMLInputElement){const w=clone(value),n=input.valueAsNumber;error='';if(!Number.isFinite(n)){error='请输入有限数值，已恢复原值。';input.value=String(value.points[i][key]);return;}if(key==='y'){w.points[1].y=w.points[2].y=clamp(n,0.25,12);}else{w.points[i].x=clamp(n,-3,6);if(w.points[3].x-w.points[0].x<0.15||w.points[2].x-w.points[1].x<0.15){error='根弦与梢弦至少 0.15 m，已恢复原值。';input.value=String(value.points[i][key]);return;}}input.value=String(w.points[i][key]);onchange(w);oncommit();}
</script>
<div class="coordinate-editor">
 <p class="direct-edit-note">直接拖动飞机上的四个顶点改变翼形。数字输入可精确调整同一组顶点。</p>
 <div class="wing-stats"><span>{metrics.span.toFixed(2)}<small>{vertical?'高度':'翼展'} m</small></span><span>{metrics.area.toFixed(2)}<small>面积 m²</small></span><span>{metrics.aspect.toFixed(1)}<small>展弦比</small></span></div>
 <details><summary>精确编辑四个顶点</summary><div class="point-table"><span>顶点</span><span>后向 x / m</span><span>{vertical?'高度':'半展'} / m</span>{#each value.points as p,i}<label for={`px${i}`}>{i+1} · {['翼根前缘','翼梢前缘','翼梢后缘','翼根后缘'][i]}</label><input id={`px${i}`} aria-label={`顶点${i+1}后向坐标`} type="number" min="-3" max="6" step="0.05" value={p.x} onchange={(e)=>numeric(i,'x',e.currentTarget)}/><input aria-label={`顶点${i+1}展向坐标`} type="number" min={i===0||i===3?0:0.25} max="12" step="0.05" value={p.y} disabled={i===0||i===3} onchange={(e)=>numeric(i,'y',e.currentTarget)}/>{/each}</div>{#if error}<p role="alert" class="field-error">{error}</p>{/if}</details>
</div>

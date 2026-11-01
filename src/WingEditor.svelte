<script lang="ts">
 import { clone, clamp, type Wing } from './model';
 import { materialCatalog, beamSection, type MaterialId, type BeamStructure } from './materials';
 let { value, vertical=false, onchange, oncommit }:{value:Wing;vertical?:boolean;onchange:(v:Wing)=>void;oncommit:()=>void}=$props();
 let error=$state('');
 let structureError=$state(''),invalidStructureField=$state<keyof BeamStructure|null>(null);
 const sectionFields=[
  {key:'width',label:'梁截面弦向宽度',min:5,max:500,step:1},
  {key:'height',label:'梁截面法向高度',min:5,max:500,step:1},
  {key:'wallThickness',label:'梁管壁厚',min:0.2,max:50,step:0.1},
 ] as const;
 let material=$derived(materialCatalog[value.materialId]),section=$derived(beamSection(value.structure));
 function structureInput(key:keyof BeamStructure,input:HTMLInputElement,commit=false){
  const field=sectionFields.find(f=>f.key===key)!,n=input.valueAsNumber;
  structureError='';invalidStructureField=null;
  const w=clone(value);w.structure[key]=n/1000;
  if(!Number.isFinite(n)||n<field.min||n>field.max)structureError=`${field.label}必须是 ${field.min}–${field.max} mm 的有限数值，已恢复原值。`;
  else if(2*w.structure.wallThickness>=Math.min(w.structure.width,w.structure.height))structureError='梁管壁厚的两倍必须小于宽度和高度，已恢复原值。';
  if(structureError){invalidStructureField=key;input.value=String(value.structure[key]*1000);return;}
  onchange(w);if(commit)oncommit();
 }
 function numeric(i:number,key:'x'|'y',input:HTMLInputElement){const w=clone(value),n=input.valueAsNumber;error='';if(!Number.isFinite(n)){error='请输入有限数值，已恢复原值。';input.value=String(value.points[i][key]);return;}if(key==='y'){w.points[1].y=w.points[2].y=clamp(n,0.25,12);}else{w.points[i].x=clamp(n,-3,6);if(w.points[3].x-w.points[0].x<0.15||w.points[2].x-w.points[1].x<0.15){error='根弦与梢弦至少 0.15 m，已恢复原值。';input.value=String(value.points[i][key]);return;}}input.value=String(w.points[i][key]);onchange(w);oncommit();}
</script>
<div class="coordinate-editor">
 <p class="direct-edit-note">拖动四个顶点，或拖动 1–4 根弦、2–3 梢弦的外伸圆形手柄，同时移动两端。顶点过近时自动外移，虚线连接真实位置。垂直位置轻微吸附，按住 Ctrl 自由微调。数字输入可精确调整同一组顶点。</p>
 <details><summary>精确编辑四个顶点</summary><div class="point-table"><span>顶点</span><span>后向 x / m</span><span>{vertical?'高度':'半展'} / m</span>{#each value.points as p,i}<label for={`px${i}`}>{i+1} · {['翼根前缘','翼梢前缘','翼梢后缘','翼根后缘'][i]}</label><input id={`px${i}`} aria-label={`顶点${i+1}后向坐标`} type="number" min="-3" max="6" step="0.05" value={p.x} onchange={(e)=>numeric(i,'x',e.currentTarget)}/><input aria-label={`顶点${i+1}展向坐标`} type="number" min={i===0||i===3?0:0.25} max="12" step="0.05" value={p.y} disabled={i===0||i===3} onchange={(e)=>numeric(i,'y',e.currentTarget)}/>{/each}</div>{#if error}<p role="alert" class="field-error">{error}</p>{/if}</details>
 <section class="structure-editor" aria-label="翼面材料与梁截面">
  <h3>材料与承力梁</h3>
  <label class="material-picker">翼面材料<select aria-label="翼面材料" value={value.materialId} onchange={e=>{const w=clone(value);w.materialId=e.currentTarget.value as MaterialId;onchange(w);oncommit();}}>
   {#each Object.entries(materialCatalog) as [id,spec]}<option value={id}>{spec.name}</option>{/each}
  </select></label>
  <dl class="material-properties">
   <div><dt>密度</dt><dd>{material.density} kg/m³</dd></div>
   <div><dt>弹性模量 E / G</dt><dd>{(material.youngModulus/1e9).toFixed(2)} / {(material.shearModulus/1e9).toFixed(2)} GPa</dd></div>
   <div><dt>{material.strengthLabel}</dt><dd>{material.yieldStrength/1e6} / {material.ultimateStrength/1e6} MPa</dd></div>
   <div><dt>等效压缩 / 剪切强度</dt><dd>{material.compressiveStrength/1e6} / {material.shearStrength/1e6} MPa</dd></div>
  </dl>
  <p class="help">{material.note}</p>
  <p class="help">材料与截面独立。闭口矩形管沿展向承力；宽度沿弦向，高度沿翼面法向。蒙皮沿用固定面密度。质量、弯曲刚度与断裂极限均参与物理。</p>
  {#each sectionFields as field}
   <div class="parameter">
    <div class="parameter-head"><label><span>{field.label}</span><input aria-label={field.label+'精确值'} type="number" min={field.min} max={field.max} step={field.step} value={Number((value.structure[field.key]*1000).toFixed(6))} aria-invalid={invalidStructureField===field.key} aria-describedby={structureError?'structure-error':undefined} onchange={e=>structureInput(field.key,e.currentTarget,true)}/><small>mm</small></label></div>
    <input aria-label={field.label} type="range" min={field.min} max={field.max} step={field.step} value={value.structure[field.key]*1000} aria-describedby={structureError?'structure-error':undefined} oninput={e=>structureInput(field.key,e.currentTarget)} onchange={oncommit}/>
   </div>
  {/each}
  {#if structureError}<p id="structure-error" role="alert" class="field-error">{structureError}</p>{/if}
  <p class="fixed-parameter">梁截面积 <output aria-label="梁截面积">{(section.area*1e6).toFixed(1)}</output> mm² · 单位长度质量 <output aria-label="梁单位长度质量">{(section.area*material.density).toFixed(3)}</output> kg/m<br/>弯曲刚度 EI <output aria-label="梁弯曲刚度">{(section.secondMoment*material.youngModulus).toFixed(0)}</output> N·m²</p>
  <p class="help">采用分段等效梁与线弹性近似；超过极限沿气动分段断裂。不是复合材料铺层分析，也不模拟真实颤振。</p>
 </section>
</div>

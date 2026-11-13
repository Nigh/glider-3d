<script lang="ts">
 import { clone, clamp, type Wing } from './model';
 import { materialCatalog, type MaterialId } from './materials';
 import Parameter from './Parameter.svelte';
 import { language, t as translate, type TranslationParams } from './i18n';
 const t=$derived.by(()=>{const locale=$language;return (source:string,params?:TranslationParams)=>translate(source,params,locale);});
 let { value, vertical=false, onchange, onpointchange, oncommit }:{value:Wing;vertical?:boolean;onchange:(v:Wing)=>void;onpointchange:(index:number,x:number,y:number)=>void;oncommit:()=>void}=$props();
 let error=$state('');
 let material=$derived(materialCatalog[value.materialId]);
 function numeric(i:number,key:'x'|'y',input:HTMLInputElement){
  const w=clone(value),n=Math.round(input.valueAsNumber*100)/100;error='';
  if(!Number.isFinite(n)){error='请输入有限数值，已恢复原值。';input.value=String(value.points[i][key]);return;}
  if(key==='y'){let height=clamp(n,vertical?-0.5:0.25,12);if(vertical&&Math.abs(height)<0.25)height=height<0?-0.25:0.25;w.points[1].y=w.points[2].y=height;}
  else{w.points[i].x=clamp(n,-3,6);if(w.points[3].x-w.points[0].x<0.15-1e-8||w.points[2].x-w.points[1].x<0.15-1e-8){error='根弦与梢弦至少 0.15 m，已恢复原值。';input.value=String(value.points[i][key]);return;}}
  onpointchange(i,w.points[i].x,w.points[i].y);oncommit();input.value=String(Number(value.points[i][key].toFixed(2)));
 }
</script>
<div class="coordinate-editor">
 <p class="direct-edit-note">{t("仅拖动圆形手柄调整顶点或同时移动根弦、梢弦两端；翼面和线段不响应拖动。手柄过近时自动外移，虚线连接真实位置。按住 Ctrl 自由微调。数字输入可精确调整顶点。")}</p>
 <details><summary>{t("精确编辑四个顶点")}</summary><div class="point-table"><span>{t("顶点")}</span><span>{t("后向 x / m")}</span><span>{vertical?t("高度"):t("半展")} / m</span>{#each value.points as p,i}<label for={`px${i}`}>{i+1} · {[t("翼根前缘"),t("翼梢前缘"),t("翼梢后缘"),t("翼根后缘")][i]}</label><input id={`px${i}`} aria-label={t("顶点{p0}后向坐标",{p0:i+1})} type="number" min="-3" max="6" step="0.01" value={Number(p.x.toFixed(2))} onchange={(e)=>numeric(i,'x',e.currentTarget)}/><input aria-label={t("顶点{p0}展向坐标",{p0:i+1})} type="number" min={i===0||i===3?0:vertical?-0.5:0.25} max="12" step="0.01" value={Number(p.y.toFixed(2))} disabled={i===0||i===3} onchange={(e)=>numeric(i,'y',e.currentTarget)}/>{/each}</div>{#if error}<p role="alert" class="field-error">{t(error)}</p>{/if}</details>
 <section class="structure-editor" aria-label={t("翼面材料")}>
  <h3>{t("翼面材料")}</h3>
  <label class="material-picker">{t("翼面材料")}<select aria-label={t("翼面材料")} value={value.materialId} onchange={e=>{const w=clone(value);w.materialId=e.currentTarget.value as MaterialId;onchange(w);oncommit();}}>
   {#each Object.entries(materialCatalog) as [id,spec]}<option value={id}>{t(spec.name)}</option>{/each}
  </select></label>
  <Parameter label={t("材料用量")} value={Math.round(value.materialAmount*100)} min={50} max={200} step={1} unit="%" onchange={n=>{const w=clone(value);w.materialAmount=n/100;onchange(w);}} {oncommit}/>
  <dl class="material-properties">
   <div><dt>{t("密度")}</dt><dd>{material.density} kg/m³</dd></div>
   <div><dt>{t("弹性模量 E / G")}</dt><dd>{(material.youngModulus/1e9).toFixed(2)} / {(material.shearModulus/1e9).toFixed(2)} GPa</dd></div>
   <div><dt>{t(material.strengthLabel)}</dt><dd>{material.yieldStrength/1e6} / {material.ultimateStrength/1e6} MPa</dd></div>
   <div><dt>{t("等效压缩 / 剪切强度")}</dt><dd>{material.compressiveStrength/1e6} / {material.shearStrength/1e6} MPa</dd></div>
  </dl>
  <p class="help">{t(material.note)}</p>
  <p class="help">{t("材料用量按平方根缩放梁尺寸；翼型厚度另缩放梁深度，翼型周长缩放蒙皮质量，改变刚度、承载能力及机翼平均密度。材料本身的密度与强度不变；不提供梁尺寸调整。")}</p>
  <p class="help">{t("采用分段等效梁与线弹性近似；超过极限沿气动分段断裂。不是复合材料铺层分析，也不模拟真实颤振。")}</p>
 </section>
</div>

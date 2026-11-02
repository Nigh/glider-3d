<script lang="ts">
 import { language, t as translate, type TranslationParams } from './i18n';
 const t=$derived.by(()=>{const locale=$language;return (source:string,params?:TranslationParams)=>translate(source,params,locale);});
 let {label,value,min,max,step=0.1,unit='',hint='',onchange,oncommit=()=>{}}:{label:string;value:number;min:number;max:number;step?:number;unit?:string;hint?:string;onchange:(n:number)=>void;oncommit?:()=>void}=$props();
 function update(n:number){if(Number.isFinite(n))onchange(Math.min(max,Math.max(min,n)));}
</script>
<div class="parameter"><div class="parameter-head"><label><span>{t(label)}</span><input aria-label={t("{p0}精确值",{p0:t(label)})} type="number" {min} {max} {step} {value} onchange={(e)=>{update(e.currentTarget.valueAsNumber);oncommit();}}/><small>{unit}</small></label></div><input aria-label={t(label)} type="range" {min} {max} {step} {value} oninput={(e)=>update(e.currentTarget.valueAsNumber)} onchange={oncommit}/>{#if hint}<p>{t(hint)}</p>{/if}</div>

<script lang="ts">
 let {label,value,min,max,step=0.1,unit='',hint='',onchange,oncommit=()=>{}}:{label:string;value:number;min:number;max:number;step?:number;unit?:string;hint?:string;onchange:(n:number)=>void;oncommit?:()=>void}=$props();
 function update(n:number){if(Number.isFinite(n))onchange(Math.min(max,Math.max(min,n)));}
</script>
<div class="parameter"><div class="parameter-head"><label><span>{label}</span><input aria-label={label+'精确值'} type="number" {min} {max} {step} {value} onchange={(e)=>{update(e.currentTarget.valueAsNumber);oncommit();}}/><small>{unit}</small></label></div><input aria-label={label} type="range" {min} {max} {step} {value} oninput={(e)=>update(e.currentTarget.valueAsNumber)} onchange={oncommit}/>{#if hint}<p>{hint}</p>{/if}</div>

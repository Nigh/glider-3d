<script lang="ts">
 import { language, t as translate } from './i18n';
 let { pitch, roll, yaw, throttle, pitchBound = true, rollBound = true, yawBound = true, throttleBound = true }: {
  pitch: number; roll: number; yaw: number; throttle: number;
  pitchBound?: boolean; rollBound?: boolean; yawBound?: boolean; throttleBound?: boolean;
 } = $props();
 const t = $derived.by(() => { const locale = $language; return (source: string) => translate(source, undefined, locale); });
 const clamp = (value: number, min = -1) => Math.max(min, Math.min(1, value));
 const shownPitch = $derived(pitchBound ? clamp(pitch) : 0);
 const shownRoll = $derived(rollBound ? clamp(roll) : 0);
 const shownYaw = $derived(yawBound ? clamp(yaw) : 0);
 const shownThrottle = $derived(throttleBound ? clamp(throttle, 0) : 0);
</script>

<div class="input-readout" aria-label={t('实时杆量')}>
 <div class="stick-readout">
  <svg class="readout-stick" class:unbound={!pitchBound && !rollBound} viewBox="0 0 120 120" role="img" aria-label={`${t('俯仰')} ${pitchBound ? shownPitch.toFixed(2) : t('未绑定')} · ${t('滚转')} ${rollBound ? shownRoll.toFixed(2) : t('未绑定')}`}>
   <circle class="stick-rim" cx="60" cy="60" r="56"/>
   <path class="stick-cross pitch-dimension" class:unbound={!pitchBound} d="M 60 8 V 112"/>
   <path class="stick-cross roll-dimension" class:unbound={!rollBound} d="M 8 60 H 112"/>
   <circle class="stick-position" class:unbound={!pitchBound && !rollBound} cx={60 + shownRoll * 35} cy={60 - shownPitch * 35} r="6" data-pitch={shownPitch} data-roll={shownRoll}/>
  </svg>
  <div class="stick-values"><span class:unbound={!pitchBound}>{t('俯仰')} <output aria-label={t('俯仰输出')}>{pitchBound ? shownPitch.toFixed(2) : t('未绑定')}</output></span><span class:unbound={!rollBound}>{t('滚转')} <output aria-label={t('滚转输出')}>{rollBound ? shownRoll.toFixed(2) : t('未绑定')}</output></span></div>
 </div>
 <div class="throttle-readout" class:unbound={!throttleBound}>
  <span>{t('油门')}</span>
  <div class="throttle-meter" role="meter" aria-label={t('油门输出')} aria-valuemin={0} aria-valuemax={1} aria-valuenow={shownThrottle} aria-valuetext={throttleBound ? `${Math.round(shownThrottle * 100)}%` : t('未绑定')} data-bound={throttleBound}><i style:height={`${shownThrottle * 100}%`}></i></div>
  <output>{throttleBound ? `${Math.round(shownThrottle * 100)}%` : t('未绑定')}</output>
 </div>
 <div class="yaw-readout" class:unbound={!yawBound}>
  <span>{t('偏航')} <output aria-label={t('偏航输出')}>{yawBound ? shownYaw.toFixed(2) : t('未绑定')}</output></span>
  <div class="yaw-meter" role="meter" aria-label={t('偏航输出')} aria-valuemin={-1} aria-valuemax={1} aria-valuenow={shownYaw} aria-valuetext={yawBound ? shownYaw.toFixed(2) : t('未绑定')} data-bound={yawBound}><i style:left={`${50 + Math.min(0, shownYaw) * 50}%`} style:width={`${Math.abs(shownYaw) * 50}%`}></i></div>
 </div>
</div>

<style>
 .input-readout{display:grid;grid-template-columns:120px minmax(44px,64px);gap:10px 18px;align-items:start;width:max-content;max-width:100%;font-size:11px}
 .readout-stick{display:block;width:120px;height:120px;border-radius:50%;background:#e9efe7}.stick-rim{fill:none;stroke:#6f8a82;stroke-width:1.5}.stick-cross{fill:none;stroke:#6f8a82;stroke-width:1;stroke-dasharray:3 4}.stick-position{fill:var(--ink);stroke:var(--panel);stroke-width:2}.stick-cross.unbound{stroke:#a5aaa8;stroke-width:3}.stick-position.unbound{fill:#a5aaa8}
 .stick-values{display:grid;gap:3px;margin-top:5px}.stick-values span,.yaw-readout>span{display:flex;justify-content:space-between;gap:8px}output{font-variant-numeric:tabular-nums}.throttle-readout{display:grid;justify-items:center;gap:5px}.throttle-meter{height:100px;width:22px;position:relative;border:1px solid #6f8a82;background:#e9efe7;border-radius:3px;overflow:hidden}.throttle-meter i{position:absolute;bottom:0;left:0;right:0;background:var(--accent)}
 .yaw-readout{grid-column:1/-1;display:grid;gap:5px}.yaw-meter{position:relative;height:16px;border:1px solid #6f8a82;background:#e9efe7;border-radius:3px;overflow:hidden}.yaw-meter:after{content:'';position:absolute;left:50%;top:0;bottom:0;border-left:1px solid #6f8a82}.yaw-meter i{position:absolute;top:0;bottom:0;background:var(--accent)}.unbound{color:var(--muted)}.unbound .throttle-meter,.unbound .yaw-meter{background:#e2e3e2;border-color:#a5aaa8}.unbound i{background:#a5aaa8}
 .readout-stick.unbound{background:#e2e3e2}.readout-stick.unbound .stick-rim{stroke:#a5aaa8}
 @media(max-width:700px){.input-readout{grid-template-columns:96px 44px;column-gap:10px}.readout-stick{width:96px;height:96px}.throttle-meter{height:76px}}
</style>

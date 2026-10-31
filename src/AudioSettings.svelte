<script lang="ts">
 import { onMount } from 'svelte';
 import type { GameAudio } from './audio';
 let { audio, error = '' }: { audio: GameAudio; error?: string } = $props();
 let muted = $state(false), music = $state(0.35), effects = $state(0.65), storageError = $state('');
 let panel: HTMLDetailsElement;
 const storageKey = 'lakewind-audio';
 function apply(save = true) {
  audio.setPreferences({ muted, music, effects });
  if (save) try { localStorage.setItem(storageKey, JSON.stringify({ muted, music, effects })); }
  catch { storageError = '浏览器无法保存声音偏好，本次设置仍有效。'; }
 }
 onMount(() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (saved && typeof saved === 'object') {
     if ('muted' in saved && typeof saved.muted === 'boolean') muted = saved.muted;
     if ('music' in saved && typeof saved.music === 'number' && Number.isFinite(saved.music)) music = Math.max(0, Math.min(1, saved.music));
     if ('effects' in saved && typeof saved.effects === 'number' && Number.isFinite(saved.effects)) effects = Math.max(0, Math.min(1, saved.effects));
   }
  } catch { storageError = '声音偏好无法读取，使用默认音量。'; }
  apply(false);
 });
</script>

<svelte:window onkeydown={e => { if (e.key === 'Escape' && panel.open) { panel.open = false; panel.querySelector('summary')?.focus(); } }}/>
<details class="audio-settings" bind:this={panel}>
 <summary aria-label="声音设置" title="声音设置">
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M11 4 5 9H2v6h3l6 5Z"/>{#if muted}<path d="m16 9 6 6m0-6-6 6"/>{:else}<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>{/if}</svg>
 </summary>
 <section aria-label="声音选项">
  <div class="heading"><h2>声音</h2><button onclick={() => { panel.open = false; panel.querySelector('summary')?.focus(); }}>关闭</button></div>
  <label class="mute"><input type="checkbox" bind:checked={muted} onchange={() => apply()}/>全部静音</label>
  <label class="volume">音乐 <output>{Math.round(music * 100)}%</output><input aria-label="音乐音量" type="range" min="0" max="1" step="0.01" bind:value={music} oninput={() => apply()}/></label>
  <label class="volume">音效 <output>{Math.round(effects * 100)}%</output><input aria-label="音效音量" type="range" min="0" max="1" step="0.01" bind:value={effects} oninput={() => apply()} onchange={() => audio.ui('click')}/></label>
  <p>首次点击或按键后启用声音。暂停或切到后台时停止播放。</p>
  {#if error}<p role="status">{error}</p>{/if}
  {#if storageError}<p role="status">{storageError}</p>{/if}
  <a href={`${import.meta.env.BASE_URL}audio/LICENSE.txt`} target="_blank" rel="noopener noreferrer">音乐署名与许可（新标签页）</a>
 </section>
</details>

<style>
 .audio-settings{position:relative;flex:none;color:var(--ink)}
 summary{display:flex;align-items:center;justify-content:center;list-style:none;width:44px;height:44px;padding:0;border-radius:5px;color:var(--ink)}
 summary::-webkit-details-marker{display:none}
  section{position:fixed;z-index:10;right:28px;top:88px;width:280px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 100px);overflow:auto;padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:5px;box-shadow:0 8px 24px #173e4320}
  summary:hover{background:#e8eee7}
 .heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
 h2{font-size:18px;margin:0}.heading button{font-size:12px;min-height:44px}
 .mute{display:flex;align-items:center;gap:10px;min-height:44px;margin-bottom:12px}.mute input{width:18px;height:18px}
 .volume{display:grid;grid-template-columns:1fr auto;align-items:center;margin-top:12px;font-size:13px}.volume input{grid-column:1/-1;min-height:44px}.volume output{font-variant-numeric:tabular-nums;color:var(--muted)}
 p{font-size:12px;line-height:1.7;color:var(--muted);margin:14px 0}a{font-size:12px;color:var(--ink);text-underline-offset:3px}
 a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
  @media(max-width:700px){section{right:12px;top:76px;max-height:calc(100dvh - 88px)}}
</style>

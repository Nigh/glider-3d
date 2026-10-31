type AudioPreferences = { muted: boolean; music: number; effects: number };
type AudioState = {
  screen: 'menu' | 'design' | 'flight' | 'result';
  ready: boolean;
  paused: boolean;
  hidden: boolean;
  speed: number;
  launching: boolean;
};
type Voice = { source: AudioScheduledSourceNode; gain: GainNode; flight: boolean };

function volume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** One shared audio clock. One-shot events are never queued across unlock or resume. */
export class GameAudio {
  private context: AudioContext | null = null;
  private music: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private lowWind: BiquadFilterNode | null = null;
  private highWind: BiquadFilterNode | null = null;
  private lowGain: GainNode | null = null;
  private highGain: GainNode | null = null;
  private steamFilter: BiquadFilterNode | null = null;
  private steamGain: GainNode | null = null;
  private voices = new Set<Voice>();
   private preferences: AudioPreferences = { muted: false, music: 0.35, effects: 0.65 };
  private state: AudioState = {
    screen: 'menu', ready: false, paused: false, hidden: false, speed: 0, launching: false,
  };
  private unlocked = false;
  private steamActive = false;
  private windStarted = false;
  private runningWanted = false;
  private playPending = false;
  private transportVersion = 0;
  private disposed = false;
  private launchPlayed = false;
  private releasePlayed = false;
  private lastSpeed = -1;
  private lastUi = -Infinity;
  private reported = new Set<string>();

  constructor(private readonly onError: (message: string) => void = () => {}) {}

  unlock(): void {
    if (this.disposed) return;
    try {
      if (!this.context) this.initialize();
       if (this.music?.error) this.music.load();
      this.unlocked = true;
      this.syncTransport(true);
    } catch {
      this.report('浏览器无法启用音频；游戏仍可继续。');
      this.dispose();
    }
  }

  setPreferences(preferences: AudioPreferences): void {
    this.preferences = {
      muted: preferences.muted,
      music: volume(preferences.music),
      effects: volume(preferences.effects),
    };
    this.applyVolumes();
  }

  update(state: AudioState): void {
    const wasFlight = this.state.screen === 'flight' && this.state.ready;
    const isFlight = state.screen === 'flight' && state.ready;
    const screenChanged = state.screen !== this.state.screen;
    this.state = state;
    if (!isFlight) {
      this.launchPlayed = false;
      this.releasePlayed = false;
      if (wasFlight) this.clearFlight();
    }
    if (screenChanged) this.applyVolumes();
    this.syncTransport();
    if (!this.context || this.disposed) return;
    const speed = isFlight && Number.isFinite(state.speed) ? Math.max(0, Math.min(60, state.speed)) : 0;
    if (Math.abs(speed - this.lastSpeed) >= 0.15 || speed === 0 && this.lastSpeed !== 0) {
      this.lastSpeed = speed;
      const strength = Math.min(1, speed / 30);
      this.smooth(this.lowGain!.gain, strength * 0.17, 0.22);
      this.smooth(this.highGain!.gain, strength * strength * 0.075, 0.22);
      this.smooth(this.lowWind!.frequency, 200 + speed * 22, 0.25);
      this.smooth(this.highWind!.frequency, 700 + speed * 55, 0.25);
    }
    if (!isFlight || !state.launching) this.silenceSteam();
  }

  launch(): void {
    if (this.launchPlayed || !this.inFlight() || !this.state.launching) return;
    this.launchPlayed = true;
    if (this.canPlay()) {
      this.steamActive = true;
      this.smooth(this.steamGain!.gain, 0.16, 0.075);
    }
  }

  release(): void {
    this.silenceSteam();
    if (this.releasePlayed || !this.inFlight()) return;
    this.releasePlayed = true;
    if (!this.canPlay()) return;
    // Original synthesis: latch snap, heavy coupling impact, inharmonic metal ring and steam vent.
    this.noiseBurst(0.13, 0.19, true);
    this.tone(2100, 900, 0.035, 0.14, true, 'sawtooth');
    this.tone(165, 52, 0.19, 0.32, true);
    this.tone(920, 900, 0.34, 0.095, true);
    this.tone(1477, 1450, 0.27, 0.06, true);
  }

  ui(kind: 'click' | 'success' | 'error'): void {
    if (!this.canPlay()) return;
    const now = this.context!.currentTime;
    if (kind === 'click' && now - this.lastUi < 0.085) return;
    if (kind === 'click') this.lastUi = now;
    if (kind === 'success') this.tone(660, 880, 0.20, 0.065, false);
    else if (kind === 'error') this.tone(280, 220, 0.17, 0.06, false);
    else this.tone(740, 620, 0.065, 0.045, false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runningWanted = false;
    if (this.music) {
      this.music.onerror = null;
      this.music.pause();
      this.music.removeAttribute('src');
      this.music.load();
    }
    for (const voice of this.voices) this.stopVoice(voice);
    this.voices.clear();
    if (this.windStarted) this.wind!.stop();
    this.wind?.disconnect();
    this.musicSource?.disconnect();
    this.lowWind?.disconnect();
    this.highWind?.disconnect();
    this.steamFilter?.disconnect();
    this.lowGain?.disconnect();
    this.highGain?.disconnect();
    this.steamGain?.disconnect();
    this.musicGain?.disconnect();
    this.effectsGain?.disconnect();
    this.master?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.noise = null;
  }

  private initialize(): void {
    const context = new AudioContext();
    this.context = context;
    this.master = context.createGain();
    this.musicGain = context.createGain();
    this.effectsGain = context.createGain();
    this.master.gain.value = 0;
    this.musicGain.gain.value = 0;
    this.effectsGain.gain.value = this.preferences.effects;
    this.musicGain.connect(this.master);
    this.effectsGain.connect(this.master);
    this.master.connect(context.destination);

    const music = new Audio(`${import.meta.env.BASE_URL}audio/piano.mp3`);
    this.music = music;
    music.loop = true;
    music.preload = 'none';
    music.onerror = () => this.report('钢琴音乐暂时无法播放；游戏仍可继续，可点击页面重试。');
    this.musicSource = context.createMediaElementSource(music);
    this.musicSource.connect(this.musicGain);

    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    this.noise = noise;
    this.wind = context.createBufferSource();
    this.wind.buffer = noise;
    this.wind.loop = true;
    this.lowWind = context.createBiquadFilter();
    this.lowWind.type = 'lowpass';
    this.lowWind.Q.value = 0.5;
    this.highWind = context.createBiquadFilter();
    this.highWind.type = 'bandpass';
    this.highWind.Q.value = 0.65;
    this.steamFilter = context.createBiquadFilter();
    this.steamFilter.type = 'bandpass';
    this.steamFilter.frequency.value = 1400;
    this.steamFilter.Q.value = 0.5;
    this.lowGain = context.createGain();
    this.highGain = context.createGain();
    this.steamGain = context.createGain();
    this.lowGain.gain.value = this.highGain.gain.value = this.steamGain.gain.value = 0;
    this.wind.connect(this.lowWind).connect(this.lowGain).connect(this.effectsGain);
    this.wind.connect(this.highWind).connect(this.highGain).connect(this.effectsGain);
    this.wind.connect(this.steamFilter).connect(this.steamGain).connect(this.effectsGain);
    this.wind.start();
    this.windStarted = true;
    this.lastSpeed = -1;
    this.applyVolumes();
     this.update(this.state);
  }

  private applyVolumes(): void {
    if (!this.context || this.disposed) return;
    this.smooth(this.master!.gain, this.preferences.muted ? 0 : 1, 0.035);
    const level = this.state.screen === 'flight' ? 0.19 : 0.3;
    this.smooth(this.musicGain!.gain, this.preferences.music * level, 0.7);
    this.smooth(this.effectsGain!.gain, this.preferences.effects, 0.035);
  }

  private syncTransport(force = false): void {
    const context = this.context;
    if (!context || this.disposed) return;
    const wanted = this.unlocked && !this.state.hidden && !this.state.paused;
    if (!force && wanted === this.runningWanted) return;
    this.runningWanted = wanted;
    const version = ++this.transportVersion;
    if (!wanted) {
      this.music!.pause();
      void context.suspend().catch(() => this.report('音频暂停失败；游戏仍可继续。'));
      return;
    }
    // Both requests run inside the gesture, not after an await that loses activation.
    void context.resume().then(() => {
      if (!this.runningWanted && !this.disposed && context.state !== 'closed') {
        return context.suspend();
      }
    }).catch(() => {
      if (this.disposed || !this.runningWanted || version !== this.transportVersion) return;
      this.unlocked = false;
      this.runningWanted = false;
      this.music?.pause();
      this.report('音频未能启动，请点击页面重试。');
    });
    if (this.music!.paused && !this.playPending) {
      this.playPending = true;
      void this.music!.play().then(() => {
        if (!this.runningWanted || this.disposed) this.music?.pause();
      }).catch((error: unknown) => {
        if (this.disposed || !this.runningWanted || error instanceof DOMException && error.name === 'AbortError') return;
        this.report('钢琴音乐暂时无法播放；游戏仍可继续，可点击页面重试。');
      }).finally(() => {
        this.playPending = false;
        if (!this.disposed && this.runningWanted && version !== this.transportVersion && this.music!.paused) {
          this.syncTransport(true);
        }
      });
    }
  }

  private inFlight(): boolean {
    return this.state.screen === 'flight' && this.state.ready;
  }

  private canPlay(): boolean {
    return !this.disposed && this.runningWanted && this.context?.state === 'running'
      && !this.preferences.muted && this.preferences.effects > 0;
  }

  private smooth(parameter: AudioParam, value: number, seconds: number): void {
    parameter.setTargetAtTime(value, this.context!.currentTime, seconds);
  }
  private silenceSteam(): void {
    if (!this.context || !this.steamGain || this.disposed || !this.steamActive) return;
    this.steamActive = false;
    this.smooth(this.steamGain.gain, 0, 0.045);
  }

  private clearFlight(): void {
    if (!this.context || this.disposed) return;
    this.silenceSteam();
    for (const voice of this.voices) if (voice.flight) this.stopVoice(voice);
  }

   private tone(from: number, to: number, duration: number, level: number, flight: boolean, type: OscillatorType = 'sine'): void {
    const context = this.context!;
    const source = context.createOscillator();
     source.type = type;
    source.frequency.setValueAtTime(from, context.currentTime);
    source.frequency.exponentialRampToValueAtTime(to, context.currentTime + duration);
    this.playVoice(source, duration, level, flight);
  }

  private noiseBurst(duration: number, level: number, flight: boolean): void {
    const source = this.context!.createBufferSource();
    source.buffer = this.noise;
    this.playVoice(source, duration, level, flight);
  }

  private playVoice(source: AudioScheduledSourceNode, duration: number, level: number, flight: boolean): void {
    const context = this.context!;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const voice: Voice = { source, gain, flight };
    this.voices.add(voice);
    source.connect(gain).connect(this.effectsGain!);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    };
    source.start();
    source.stop(now + duration + 0.015);
  }

  private stopVoice(voice: Voice): void {
    voice.source.onended = null;
    voice.source.stop();
    voice.source.disconnect();
    voice.gain.disconnect();
    this.voices.delete(voice);
  }

  private report(message: string): void {
    if (this.disposed || this.reported.has(message)) return;
    this.reported.add(message);
    try { this.onError(message); } catch { /* Audio errors never interrupt gameplay. */ }
  }
}

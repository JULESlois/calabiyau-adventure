import {
  MUSIC_LIBRARY,
  MUSIC_LOOP_BARS,
  MUSIC_STEPS_PER_BAR,
  type MusicCue,
  type MusicDefinition,
  type MusicIntensity,
  type PercussionStyle,
} from './music';

type SfxName =
  | 'jump'
  | 'doubleJump'
  | 'shootIce'
  | 'shootNote'
  | 'melee'
  | 'meleeHit'
  | 'hurt'
  | 'enemyDie'
  | 'pickup'
  | 'crystal'
  | 'paperOn'
  | 'paperOff'
  | 'skillHeal'
  | 'switch'
  | 'explosion'
  | 'bossRoar'
  | 'checkpoint'
  | 'ui';

export type MusicStinger = 'ability' | 'bossAwaken' | 'bossDefeat' | 'victory';

export interface MusicMix {
  intensity: MusicIntensity;
  ducked: boolean;
}

interface MusicVoice {
  cue: MusicCue;
  definition: MusicDefinition;
  input: BiquadFilterNode;
  bus: GainNode;
  step: number;
  nextStepTime: number;
  retireAt: number | null;
}

const LOOK_AHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;
// 保持音效清晰的同时让旋律在普通战斗中仍能被听见。
const TARGET_MUSIC_VOL = 0.5;
const DUCKED_MUSIC_VOL = 0.2;

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private schedulerTimer: number | null = null;
  private voices: MusicVoice[] = [];
  private desiredCue: MusicCue | null = null;
  private mix: MusicMix = { intensity: 0, ducked: false };
  muted = false;
  /** 玩家偏好的音乐/音效倍率(0..1),乘在既有的 duck/强度逻辑之上 */
  private musicVolPref = 0.8;
  private sfxVolPref = 0.8;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;

      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -10;
      this.limiter.knee.value = 4;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.24;
      this.master.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = (this.mix.ducked ? DUCKED_MUSIC_VOL : TARGET_MUSIC_VOL) * this.musicVolPref;
      this.musicGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolPref;
      this.sfxGain.connect(this.master);
      this.noiseBuffer = this.createNoiseBuffer();

      this.ensureScheduler();
      if (this.desiredCue) this.crossfadeTo(this.desiredCue, 0.8);
    } catch {
      this.ctx = null;
      this.master = null;
      this.limiter = null;
      this.musicGain = null;
      this.sfxGain = null;
    }
  }

  /** 应用玩家偏好(设置菜单与启动时调用)。 */
  applyVolumePrefs(musicVol: number, sfxVol: number, muted: boolean): void {
    this.musicVolPref = musicVol;
    this.sfxVolPref = sfxVol;
    this.muted = muted;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.master) {
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.5, now + 0.04);
    }
    if (this.musicGain) {
      const target = (this.mix.ducked ? DUCKED_MUSIC_VOL : TARGET_MUSIC_VOL) * musicVol;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.linearRampToValueAtTime(target, now + 0.06);
    }
    if (this.sfxGain) {
      this.sfxGain.gain.cancelScheduledValues(now);
      this.sfxGain.gain.setValueAtTime(this.sfxGain.gain.value, now);
      this.sfxGain.gain.linearRampToValueAtTime(sfxVol, now + 0.06);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.5, now + 0.04);
    }
    return this.muted;
  }

  setMusicState(mix: MusicMix): void {
    const intensity = Math.max(0, Math.min(2, mix.intensity)) as MusicIntensity;
    if (this.mix.intensity === intensity && this.mix.ducked === mix.ducked) return;
    this.mix = { intensity, ducked: mix.ducked };
    if (this.musicGain && this.ctx) {
      const now = this.ctx.currentTime;
      const target = (mix.ducked ? DUCKED_MUSIC_VOL : TARGET_MUSIC_VOL) * this.musicVolPref;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.linearRampToValueAtTime(target, now + 0.18);
    }
  }

  getMusicSnapshot(): {
    cue: MusicCue | null;
    intensity: MusicIntensity;
    ducked: boolean;
    voices: number;
    context: AudioContextState | 'locked';
  } {
    return {
      cue: this.desiredCue,
      intensity: this.mix.intensity,
      ducked: this.mix.ducked,
      voices: this.voices.length,
      context: this.ctx?.state ?? 'locked',
    };
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slide = 0,
    delay = 0,
  ): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(Math.max(0.001, vol), t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq = 1000): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer || this.muted) return;
    const t0 = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    source.start(t0);
    source.stop(t0 + dur + 0.02);
  }

  sfx(name: SfxName | string): void {
    switch (name) {
      case 'jump': this.tone(280, 0.12, 'square', 0.12, 240); break;
      case 'doubleJump': this.tone(360, 0.14, 'square', 0.12, 300); break;
      case 'shootIce': this.tone(900, 0.08, 'square', 0.07, -500); break;
      case 'shootNote':
        this.tone(660, 0.09, 'triangle', 0.1, 120);
        this.tone(830, 0.09, 'triangle', 0.06, 120, 0.03);
        break;
      case 'melee': this.noise(0.08, 0.1, 2600); break;
      case 'meleeHit': this.noise(0.1, 0.16, 1200); this.tone(140, 0.1, 'square', 0.1, -60); break;
      case 'hurt': this.tone(200, 0.25, 'sawtooth', 0.16, -120); break;
      case 'enemyDie': this.noise(0.22, 0.14, 900); this.tone(320, 0.2, 'square', 0.08, -260); break;
      case 'pickup': this.tone(520, 0.1, 'square', 0.1, 200); this.tone(780, 0.12, 'square', 0.08, 200, 0.07); break;
      case 'crystal': this.tone(1040, 0.14, 'triangle', 0.12, 300); break;
      case 'paperOn': this.noise(0.12, 0.07, 4000); this.tone(1200, 0.1, 'sine', 0.06, 500); break;
      case 'paperOff': this.tone(700, 0.1, 'sine', 0.06, -300); break;
      case 'skillHeal':
        this.tone(523, 0.16, 'triangle', 0.1);
        this.tone(659, 0.16, 'triangle', 0.1, 0, 0.1);
        this.tone(784, 0.24, 'triangle', 0.1, 0, 0.2);
        break;
      case 'switch': this.tone(440, 0.07, 'square', 0.1, 260); this.tone(880, 0.08, 'square', 0.07, 100, 0.06); break;
      case 'explosion': this.noise(0.5, 0.28, 500); this.tone(90, 0.45, 'sawtooth', 0.15, -40); break;
      case 'bossRoar': this.noise(0.7, 0.2, 300); this.tone(70, 0.7, 'sawtooth', 0.2, 30); break;
      case 'checkpoint': this.tone(587, 0.12, 'square', 0.1); this.tone(880, 0.18, 'square', 0.1, 0, 0.1); break;
      case 'ui': this.tone(600, 0.05, 'square', 0.07); break;
      default: break;
    }
  }

  playSong(cue: MusicCue | -1, fadeTime = 0.9): void {
    const nextCue = cue === -1 ? null : cue;
    if (nextCue === this.desiredCue) return;
    this.desiredCue = nextCue;
    if (!this.ctx || !this.musicGain) return;
    this.crossfadeTo(nextCue, Math.max(0.08, fadeTime));
  }

  playStinger(kind: MusicStinger): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const definition = MUSIC_LIBRARY[this.desiredCue ?? 'title'];
    const now = this.ctx.currentTime;
    const patterns: Record<MusicStinger, { degrees: number[]; spacing: number; octave: number; wave: OscillatorType }> = {
      ability: { degrees: [0, 2, 4, 7], spacing: 0.09, octave: 1, wave: 'triangle' },
      bossAwaken: { degrees: [0, 3, 1, 6], spacing: 0.12, octave: -1, wave: 'sawtooth' },
      bossDefeat: { degrees: [6, 4, 3, 1, 0], spacing: 0.16, octave: 0, wave: 'triangle' },
      victory: { degrees: [0, 2, 4, 6, 7], spacing: 0.14, octave: 1, wave: 'triangle' },
    };
    const pattern = patterns[kind];
    for (let i = 0; i < pattern.degrees.length; i++) {
      const frequency = this.frequencyFor(definition, pattern.degrees[i], pattern.octave, 0);
      this.scheduleNote(this.sfxGain, frequency, now + i * pattern.spacing, pattern.spacing * 2.2, pattern.wave, 0.07);
    }
  }

  private crossfadeTo(cue: MusicCue | null, fadeTime: number): void {
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const end = now + fadeTime;
    for (const voice of this.voices) {
      voice.bus.gain.cancelScheduledValues(now);
      voice.bus.gain.setValueAtTime(voice.bus.gain.value, now);
      voice.bus.gain.linearRampToValueAtTime(0.001, end);
      voice.retireAt = end + LOOK_AHEAD_SECONDS;
    }
    if (!cue) return;

    const definition = MUSIC_LIBRARY[cue];
    const input = this.ctx.createBiquadFilter();
    input.type = 'lowpass';
    input.frequency.value = definition.cutoff;
    input.Q.value = definition.resonance;
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(0.001, now);
    bus.gain.linearRampToValueAtTime(1, end);
    input.connect(bus);
    bus.connect(this.musicGain);
    this.voices.push({
      cue,
      definition,
      input,
      bus,
      step: 0,
      nextStepTime: now + 0.04,
      retireAt: null,
    });
    this.ensureScheduler();
    this.schedulerTick();
  }

  private ensureScheduler(): void {
    if (this.schedulerTimer !== null) return;
    this.schedulerTimer = window.setInterval(() => this.schedulerTick(), SCHEDULER_INTERVAL_MS);
  }

  private schedulerTick(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOK_AHEAD_SECONDS;
    for (const voice of this.voices) {
      while (
        voice.nextStepTime < horizon &&
        (voice.retireAt === null || voice.nextStepTime < voice.retireAt)
      ) {
        this.scheduleMusicStep(voice, voice.nextStepTime);
        voice.step = (voice.step + 1) % (MUSIC_STEPS_PER_BAR * MUSIC_LOOP_BARS);
        voice.nextStepTime += 60 / voice.definition.bpm / 4;
      }
    }
    const retired = this.voices.filter((voice) => voice.retireAt !== null && voice.retireAt <= now);
    this.voices = this.voices.filter((voice) => voice.retireAt === null || voice.retireAt > now);
    for (const voice of retired) {
      voice.input.disconnect();
      voice.bus.disconnect();
    }
  }

  private scheduleMusicStep(voice: MusicVoice, time: number): void {
    const definition = voice.definition;
    const stepInBar = voice.step % MUSIC_STEPS_PER_BAR;
    const bar = Math.floor(voice.step / MUSIC_STEPS_PER_BAR);
    const phrase = Math.floor(bar / 8) % 3;
    const chord = definition.chords[bar % definition.chords.length];
    const stepDuration = 60 / definition.bpm / 4;

    if (stepInBar % 4 === 0) {
      const quarter = stepInBar / 4;
      const degree = definition.bass[(bar + quarter) % definition.bass.length];
      const frequency = this.frequencyFor(definition, degree, -2, chord);
      this.scheduleNote(voice.input, frequency, time, stepDuration * 3.4, definition.bassWave, 0.16);
    }

    if (stepInBar === 0 || (this.mix.intensity > 0 && stepInBar === 8)) {
      const duration = stepDuration * (this.mix.intensity > 0 ? 7.5 : 11.5);
      const chordDegrees = phrase === 2 ? [0, 3, 5] : [0, 2, 4];
      for (const degree of chordDegrees) {
        const frequency = this.frequencyFor(definition, degree, -1, chord);
        this.scheduleNote(voice.input, frequency, time, duration, definition.padWave, 0.024);
      }
    }

    if (stepInBar % 2 === 0 && (this.mix.intensity > 0 || stepInBar % 4 === 0)) {
      const melody = phrase === 1 ? definition.melodyB : definition.melodyA;
      const index = (stepInBar / 2 + bar * 2) % melody.length;
      const degree = melody[index];
      if (degree >= 0) {
        const octave = phrase === 2 ? 1 : 0;
        const frequency = this.frequencyFor(definition, degree, octave, chord);
        const volume = this.mix.intensity === 0 ? 0.038 : this.mix.intensity === 1 ? 0.055 : 0.07;
        this.scheduleNote(voice.input, frequency, time, stepDuration * 1.7, definition.leadWave, volume);
      }
    }

    if (this.mix.intensity === 2 && stepInBar % 4 === 2) {
      const degree = definition.melodyB[(bar + stepInBar / 2) % definition.melodyB.length];
      if (degree >= 0) {
        const frequency = this.frequencyFor(definition, degree, 1, chord);
        this.scheduleNote(voice.input, frequency, time, stepDuration * 0.8, 'square', 0.025);
      }
    }

    this.schedulePercussion(voice.input, definition.percussion, stepInBar, time, this.mix.intensity);
  }

  private schedulePercussion(
    output: AudioNode,
    style: PercussionStyle,
    step: number,
    time: number,
    intensity: MusicIntensity,
  ): void {
    if (style === 'none' || intensity === 0 || !this.ctx) return;
    const strongBeat = step === 0 || step === 8;
    const backBeat = step === 4 || step === 12;

    if (strongBeat) {
      const kickVolume = style === 'submerged' ? 0.055 : style === 'industrial' ? 0.095 : 0.065;
      this.scheduleKick(output, time, kickVolume);
    }
    if (backBeat && style !== 'air') {
      const filter = style === 'submerged' ? 480 : style === 'ritual' ? 950 : 1500;
      this.scheduleNoise(output, time, 0.075, intensity === 2 ? 0.055 : 0.035, filter, 'bandpass');
    }
    const hatStep = style === 'mechanical' || style === 'industrial' ? step % 2 === 0 : step % 4 === 2;
    if (hatStep && (intensity === 2 || step % 4 === 2)) {
      const filter = style === 'air' ? 4200 : 2800;
      this.scheduleNoise(output, time, 0.025, intensity === 2 ? 0.025 : 0.014, filter, 'highpass');
    }
  }

  private scheduleKick(output: AudioNode, time: number, volume: number): void {
    if (!this.ctx) return;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(105, time);
    oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(time);
    oscillator.stop(time + 0.14);
  }

  private scheduleNoise(
    output: AudioNode,
    time: number,
    duration: number,
    volume: number,
    frequency: number,
    type: BiquadFilterType,
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  private scheduleNote(
    output: AudioNode,
    frequency: number,
    time: number,
    duration: number,
    wave: OscillatorType,
    volume: number,
  ): void {
    if (!this.ctx) return;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const attack = Math.min(0.018, duration * 0.2);
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(Math.max(30, frequency), time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), time + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain);
    gain.connect(output);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
  }

  private frequencyFor(definition: MusicDefinition, degree: number, octave: number, chord: number): number {
    const length = definition.scale.length;
    const wrapped = ((degree % length) + length) % length;
    const degreeOctave = Math.floor(degree / length);
    const semitones = definition.scale[wrapped] + chord + (degreeOctave + octave) * 12;
    return definition.root * Math.pow(2, semitones / 12);
  }

  private createNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  dispose(): void {
    if (this.schedulerTimer !== null) window.clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    for (const voice of this.voices) {
      voice.input.disconnect();
      voice.bus.disconnect();
    }
    this.voices = [];
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}

// 纯 WebAudio 合成音效与简易芯片音乐,无外部素材。
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
  | 'skillIce'
  | 'skillHeal'
  | 'switch'
  | 'explosion'
  | 'bossRoar'
  | 'checkpoint'
  | 'ui';

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  muted = false;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private currentSong = -1;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slide = 0,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq = 1000): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
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
      case 'skillIce': this.noise(0.4, 0.12, 3000); this.tone(1500, 0.5, 'sine', 0.08, -900); break;
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

  /** songId: 0 标题, 1..3 关卡, 4 Boss, -1 停止 */
  playSong(songId: number): void {
    if (songId === this.currentSong) return;
    this.currentSong = songId;
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (songId < 0) return;
    this.musicStep = 0;
    const tempo = [300, 220, 200, 190, 160][songId] ?? 220;
    this.musicTimer = window.setInterval(() => this.musicTick(), tempo);
  }

  private musicTick(): void {
    if (!this.ctx || !this.musicGain || this.muted) {
      this.musicStep++;
      return;
    }
    // 五声音阶,不同歌曲不同移调与走向
    const scale = [0, 3, 5, 7, 10];
    const songs: Record<number, { base: number; bass: number; pat: number[] }> = {
      0: { base: 392, bass: 98, pat: [0, 2, 4, 2, 3, 2, 1, 2] },
      1: { base: 440, bass: 110, pat: [0, 1, 2, 4, 3, 2, 1, 0] },
      2: { base: 349, bass: 87, pat: [4, 2, 3, 1, 2, 0, 1, 2] },
      3: { base: 494, bass: 123, pat: [0, 2, 1, 3, 2, 4, 3, 2] },
      4: { base: 311, bass: 78, pat: [0, 0, 3, 0, 4, 3, 1, 0] },
    };
    const song = songs[this.currentSong] ?? songs[1];
    const step = this.musicStep % 16;
    const bar = Math.floor(this.musicStep / 16) % 4;
    const t0 = this.ctx.currentTime;

    // 低音
    if (step % 4 === 0) {
      const bf = song.bass * (bar === 3 ? 1.5 : bar === 1 ? 1.19 : 1);
      this.musicNote(bf, 0.28, 'triangle', 0.5, t0);
    }
    // 主旋律
    if (step % 2 === 0) {
      const idx = song.pat[(step / 2 + bar * 2) % 8];
      const semis = scale[idx % 5] + (bar === 2 ? 2 : 0);
      const f = song.base * Math.pow(2, semis / 12);
      this.musicNote(f, 0.16, 'square', 0.22, t0);
    }
    // 打击(噪声由主音路径太贵,这里用极短高频方波模拟 hat)
    if (this.currentSong === 4 && step % 4 === 2) {
      this.musicNote(2200, 0.03, 'square', 0.1, t0);
    }
    this.musicStep++;
  }

  private musicNote(freq: number, dur: number, type: OscillatorType, vol: number, t0: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  dispose(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    if (this.ctx) void this.ctx.close();
  }
}

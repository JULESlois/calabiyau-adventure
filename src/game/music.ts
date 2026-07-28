export type MusicCue =
  | 'title'
  | 'coast'
  | 'tide'
  | 'lab'
  | 'choir'
  | 'sky'
  | 'hangar'
  | 'boss'
  | 'ending';

export type MusicIntensity = 0 | 1 | 2;
export type PercussionStyle = 'none' | 'soft' | 'submerged' | 'mechanical' | 'ritual' | 'air' | 'industrial';

export interface MusicDefinition {
  bpm: number;
  root: number;
  scale: number[];
  chords: number[];
  melodyA: number[];
  melodyB: number[];
  bass: number[];
  leadWave: OscillatorType;
  padWave: OscillatorType;
  bassWave: OscillatorType;
  percussion: PercussionStyle;
  cutoff: number;
  resonance: number;
}

export const MUSIC_STEPS_PER_BAR = 16;
export const MUSIC_LOOP_BARS = 24;

/**
 * 每个区域使用独立调式、速度与音色。旋律中的 -1 表示休止，其他数字表示音阶级数。
 * 24 小节由三个八小节乐句构成，调度器会在后两个乐句改变织体和音区。
 */
export const MUSIC_LIBRARY: Record<MusicCue, MusicDefinition> = {
  title: {
    bpm: 78,
    root: 196,
    scale: [0, 2, 3, 7, 8, 10, 12],
    chords: [0, 0, 3, -2, 0, 5, 3, -2],
    melodyA: [0, -1, 2, 3, 4, 3, 2, -1, 0, 2, 5, 4, 3, 2, 1, -1],
    melodyB: [4, 3, 2, 0, -1, 2, 3, 5, 4, 2, 1, 0, 2, 1, 0, -1],
    bass: [0, 0, 3, 1, 0, 4, 3, 1],
    leadWave: 'triangle', padWave: 'sine', bassWave: 'triangle',
    percussion: 'none', cutoff: 1850, resonance: 1.4,
  },
  coast: {
    bpm: 88,
    root: 220,
    scale: [0, 2, 4, 7, 9, 12, 14],
    chords: [0, 5, 7, 2, 0, -3, 5, 7],
    melodyA: [0, 2, 3, -1, 4, 3, 2, 1, 0, -1, 2, 4, 3, 2, 1, -1],
    melodyB: [2, 4, 5, 4, 3, -1, 2, 1, 0, 2, 3, 5, 4, 3, 2, -1],
    bass: [0, 3, 4, 1, 0, 2, 3, 4],
    leadWave: 'triangle', padWave: 'sine', bassWave: 'triangle',
    percussion: 'soft', cutoff: 2400, resonance: 0.8,
  },
  tide: {
    bpm: 72,
    root: 174.61,
    scale: [0, 2, 3, 7, 8, 10, 12],
    chords: [0, -2, 3, 0, -5, -2, 3, -2],
    melodyA: [0, -1, 3, -1, 2, 1, -1, 0, 4, -1, 3, 2, 1, -1, 0, -1],
    melodyB: [2, -1, 4, 3, -1, 2, 0, -1, 3, 2, 1, -1, 0, 1, 0, -1],
    bass: [0, 0, 1, 0, 3, 1, 2, 1],
    leadWave: 'sine', padWave: 'triangle', bassWave: 'sine',
    percussion: 'submerged', cutoff: 1050, resonance: 3.2,
  },
  lab: {
    bpm: 104,
    root: 207.65,
    scale: [0, 1, 5, 6, 7, 10, 12],
    chords: [0, 1, -1, 6, 0, -5, 1, -1],
    melodyA: [0, 1, 3, 2, -1, 4, 3, 1, 0, 3, 5, 4, 2, 1, -1, 3],
    melodyB: [5, 3, 1, 2, 4, -1, 3, 0, 1, 4, 3, 2, 6, 4, 2, -1],
    bass: [0, 1, 0, 3, 0, 2, 1, 0],
    leadWave: 'square', padWave: 'sine', bassWave: 'triangle',
    percussion: 'mechanical', cutoff: 2850, resonance: 5.5,
  },
  choir: {
    bpm: 76,
    root: 196,
    scale: [0, 2, 3, 5, 7, 8, 11],
    chords: [0, 5, 3, -2, 0, 8, 5, 3],
    melodyA: [0, 2, 4, 3, 2, -1, 1, 0, 4, 5, 6, 5, 4, 2, 1, -1],
    melodyB: [3, 5, 6, 4, 5, 3, 2, -1, 1, 3, 4, 2, 1, 0, -1, 0],
    bass: [0, 3, 2, 1, 0, 5, 3, 2],
    leadWave: 'sine', padWave: 'triangle', bassWave: 'triangle',
    percussion: 'ritual', cutoff: 1700, resonance: 2.1,
  },
  sky: {
    bpm: 96,
    root: 261.63,
    scale: [0, 2, 5, 7, 9, 12, 14],
    chords: [0, 7, 5, 2, 9, 7, 5, 7],
    melodyA: [0, 2, 4, 5, 4, 3, -1, 2, 1, 3, 5, 6, 5, 4, 2, -1],
    melodyB: [4, 6, 5, 3, 4, 2, 1, -1, 2, 4, 6, 5, 3, 2, 0, -1],
    bass: [0, 4, 3, 1, 4, 3, 2, 4],
    leadWave: 'triangle', padWave: 'sine', bassWave: 'sine',
    percussion: 'air', cutoff: 3300, resonance: 1.2,
  },
  hangar: {
    bpm: 110,
    root: 164.81,
    scale: [0, 1, 3, 6, 7, 10, 12],
    chords: [0, 0, 3, 1, 0, 6, 3, 1],
    melodyA: [0, -1, 2, 3, 2, -1, 1, 0, 3, -1, 4, 3, 2, 1, 0, -1],
    melodyB: [3, 4, 5, 3, 2, -1, 4, 2, 1, 3, 4, 6, 5, 3, 2, -1],
    bass: [0, 0, 2, 1, 0, 3, 2, 1],
    leadWave: 'sawtooth', padWave: 'triangle', bassWave: 'square',
    percussion: 'industrial', cutoff: 1450, resonance: 2.8,
  },
  boss: {
    bpm: 140,
    root: 155.56,
    scale: [0, 1, 3, 6, 7, 8, 11],
    chords: [0, 1, 6, 3, 0, -2, 1, 6],
    melodyA: [0, 0, 3, 0, 4, 3, 1, 0, 5, 4, 3, 1, 0, 3, 6, -1],
    melodyB: [6, 4, 3, 1, 0, 3, 4, 5, 6, 5, 3, 4, 2, 1, 0, -1],
    bass: [0, 0, 3, 0, 4, 3, 1, 0],
    leadWave: 'sawtooth', padWave: 'square', bassWave: 'sawtooth',
    percussion: 'industrial', cutoff: 2150, resonance: 4.5,
  },
  ending: {
    bpm: 68,
    root: 220,
    scale: [0, 2, 4, 7, 9, 11, 12],
    chords: [0, 5, 7, 9, 5, 2, 7, 0],
    melodyA: [0, 2, 4, 5, 4, 2, 1, 0, 2, 4, 6, 5, 4, 2, 1, -1],
    melodyB: [4, 5, 6, 7, 6, 5, 4, 2, 3, 5, 7, 6, 5, 4, 2, 0],
    bass: [0, 3, 4, 5, 3, 1, 4, 0],
    leadWave: 'triangle', padWave: 'sine', bassWave: 'triangle',
    percussion: 'soft', cutoff: 2600, resonance: 0.7,
  },
};

export function musicLoopSeconds(cue: MusicCue): number {
  const stepSeconds = 60 / MUSIC_LIBRARY[cue].bpm / 4;
  return stepSeconds * MUSIC_STEPS_PER_BAR * MUSIC_LOOP_BARS;
}

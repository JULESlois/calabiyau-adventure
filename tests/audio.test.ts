import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioSys } from '../src/game/Audio';
import { MUSIC_LIBRARY, musicLoopSeconds, type MusicCue } from '../src/game/music';
import { ZONES } from '../src/game/world/world';

test('every region has its own music identity', () => {
  // 从数据推导,不写死区域数 —— 加一个区域不该需要改这条用例
  const cues = Object.values(ZONES).map((zone) => zone.song);
  assert.equal(new Set(cues).size, cues.length, `配乐重复:${cues.join(', ')}`);
  for (const cue of cues) assert.ok(MUSIC_LIBRARY[cue], `${cue} 没有曲目定义`);
});

test('exploration themes run for at least fifty seconds before their full phrase cycle repeats', () => {
  const cues = Object.values(ZONES).map((zone) => zone.song);
  for (const cue of cues) {
    assert.ok(musicLoopSeconds(cue) >= 50, `${cue}: ${musicLoopSeconds(cue).toFixed(2)}s`);
  }
});

test('music state can be prepared before browser audio is unlocked', () => {
  const audio = new AudioSys();
  audio.playSong('coast');
  audio.setMusicState({ intensity: 2, ducked: true });
  assert.deepEqual(audio.getMusicSnapshot(), {
    cue: 'coast',
    intensity: 2,
    ducked: true,
    voices: 0,
    context: 'locked',
  });

  audio.playSong(-1);
  assert.equal(audio.getMusicSnapshot().cue, null);
});

test('the music library includes dedicated title, boss and ending cues', () => {
  const special: MusicCue[] = ['title', 'boss', 'ending'];
  for (const cue of special) {
    assert.ok(MUSIC_LIBRARY[cue]);
    assert.ok(musicLoopSeconds(cue) > 35);
  }
});

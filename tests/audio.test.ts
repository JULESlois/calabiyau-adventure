import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioSys } from '../src/game/Audio';
import { MUSIC_LIBRARY, musicLoopSeconds, type MusicCue } from '../src/game/music';
import { ZONES } from '../src/game/world/world';

test('all six regions have distinct music identities', () => {
  const cues = Object.values(ZONES).map((zone) => zone.song);
  assert.equal(new Set(cues).size, 6);
  assert.deepEqual(cues, ['coast', 'tide', 'lab', 'choir', 'sky', 'hangar']);
  for (const cue of cues) assert.ok(MUSIC_LIBRARY[cue]);
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

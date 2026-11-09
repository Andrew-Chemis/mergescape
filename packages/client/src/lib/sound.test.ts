/**
 * Opt-in sound (game-design.md section 9, Requirement 10.5): the nine cues, and the rules around them. Sound
 * is off by default, no `AudioContext` exists while it is off (whatever the page prefers), nothing plays
 * before a gesture, and everything is short and quiet.
 */
import { describe, expect, it, vi } from 'vitest';
import { consent } from './consent';
import { mockReducedMotion } from '../test/helpers';
import { FakeAudioContext, gesture, soundOnAfterGesture, stubAudio } from '../test/audio';
import {
  armSound,
  createSound,
  CUE_NAMES,
  CUES,
  cueSeconds,
  MASTER_GAIN,
  MAX_CUE_SECONDS,
  playCue,
  semitones,
  sound,
  soundOn,
} from './sound';

describe('the nine cues', () => {
  it('are one per moment, level-up, Feat, Mogul, purchase, act clear and expedition return', () => {
    expect(CUE_NAMES).toEqual([
      'tick',
      'levelUp',
      'lootFlip',
      'lootGlint',
      'feat',
      'mogul',
      'purchase',
      'actClear',
      'expeditionReturn',
    ]);
    expect(CUE_NAMES).toHaveLength(9);
    expect(Object.keys(CUES).sort()).toEqual([...CUE_NAMES].sort());
  });

  it('are short: every cue ends within a second and a half, and the small ones far sooner', () => {
    for (const cue of CUE_NAMES) {
      expect(cueSeconds(cue), cue).toBeGreaterThan(0);
      expect(cueSeconds(cue), cue).toBeLessThanOrEqual(MAX_CUE_SECONDS);
    }
    expect(cueSeconds('tick')).toBeLessThan(0.1);
    expect(cueSeconds('lootFlip')).toBeLessThan(0.15);
  });

  it('are quiet: no voice is louder than its level allows, and the master gain is about a fifth', () => {
    expect(MASTER_GAIN).toBeLessThanOrEqual(0.25);
    for (const cue of CUE_NAMES) {
      const voices = CUES[cue];
      expect(voices.length, cue).toBeGreaterThan(0);
      // The loudest instant of a cue: the voices sounding together at some voice's start.
      const peak = Math.max(
        ...voices.map((at) =>
          voices
            .filter((voice) => voice.start <= at.start && at.start < voice.start + voice.length)
            .reduce((sum, voice) => sum + voice.gain, 0),
        ),
      );
      expect(peak * MASTER_GAIN, cue).toBeLessThanOrEqual(0.25);
      for (const voice of voices) {
        expect(voice.gain).toBeGreaterThan(0);
        expect(voice.length).toBeGreaterThan(0.03);
        expect(voice.start).toBeGreaterThanOrEqual(0);
        expect(voice.from).toBeGreaterThan(20);
        expect(voice.from).toBeLessThan(5000);
      }
    }
  });

  it('are synthesised from oscillators alone: plain data, no audio file or URL anywhere', () => {
    const text = JSON.stringify(CUES);
    expect(text).not.toMatch(/\.(mp3|ogg|wav|flac|m4a)|https?:|data:audio/i);
    for (const voice of Object.values(CUES).flat()) {
      expect(['sine', 'square', 'sawtooth', 'triangle']).toContain(voice.wave);
    }
  });

  it('transposes by equal-tempered semitones', () => {
    expect(semitones(0)).toBe(1);
    expect(semitones(12)).toBeCloseTo(2, 10);
    expect(semitones(7)).toBeCloseTo(1.4983, 3);
  });
});

describe('sound is off by default and creates nothing while it is off', () => {
  it('reads as off on a fresh device', () => {
    expect(soundOn()).toBe(false);
    expect(window.localStorage.getItem('mergescape.consent')).toBeNull();
  });

  it('builds no AudioContext, even after a gesture and a cue', () => {
    const audio = stubAudio();
    armSound();
    gesture();
    expect(sound.unlocked()).toBe(true);
    for (const cue of CUE_NAMES) {
      expect(playCue(cue)).toBe(false);
    }
    expect(audio.contexts).toHaveLength(0);
    expect(sound.started()).toBe(false);
  });

  it('builds none under prefers-reduced-motion either: the preference is explicit, never inferred', () => {
    mockReducedMotion(true);
    const audio = stubAudio();
    armSound();
    gesture('keydown');
    expect(playCue('levelUp')).toBe(false);
    expect(playCue('feat')).toBe(false);
    expect(audio.contexts).toHaveLength(0);
    expect(soundOn()).toBe(false);
  });

  it('builds none when the preference was damaged or hand-edited to anything but a literal true', () => {
    const audio = stubAudio();
    for (const raw of [
      '{"sound":"true"}',
      '{"sound":1}',
      '{"sound":"yes"}',
      '{"analytics":true}',
      'not json',
    ]) {
      window.localStorage.setItem('mergescape.consent', raw);
      armSound();
      gesture();
      expect(playCue('purchase'), raw).toBe(false);
      sound.reset();
    }
    expect(audio.contexts).toHaveLength(0);
  });

  it('is off again after the preference is switched off: no further context, no further cue', () => {
    const audio = soundOnAfterGesture();
    expect(playCue('tick')).toBe(true);
    expect(audio.contexts).toHaveLength(1);
    consent.setSound(false);
    expect(playCue('tick')).toBe(false);
    expect(audio.oscillators()).toHaveLength(1);
  });
});

describe('only after a gesture', () => {
  it('drops a cue asked for before the page was touched, and does not queue it', () => {
    const audio = stubAudio();
    consent.setSound(true);
    armSound();
    expect(sound.unlocked()).toBe(false);
    expect(playCue('levelUp')).toBe(false);
    expect(audio.contexts).toHaveLength(0);
    gesture();
    // Nothing was queued: the dropped cue does not play late.
    expect(audio.oscillators()).toHaveLength(0);
    expect(playCue('levelUp')).toBe(true);
  });

  it.each(['pointerdown', 'keydown', 'touchstart', 'click'] as const)(
    'a %s counts as a gesture',
    (type) => {
      stubAudio();
      consent.setSound(true);
      armSound();
      gesture(type);
      expect(sound.unlocked()).toBe(true);
    },
  );

  it('other events do not: moving the mouse or scrolling is not a touch', () => {
    stubAudio();
    consent.setSound(true);
    armSound();
    window.dispatchEvent(new Event('pointermove'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('mousemove'));
    expect(sound.unlocked()).toBe(false);
  });

  it('prepares the context inside the gesture when sound is already on, so a browser lets it start', () => {
    const audio = stubAudio();
    consent.setSound(true);
    armSound();
    expect(audio.contexts).toHaveLength(0);
    gesture();
    expect(audio.contexts).toHaveLength(1);
  });

  it('resumes a context the browser created suspended', () => {
    const audio = stubAudio();
    consent.setSound(true);
    armSound();
    gesture();
    const context = audio.contexts[0] as FakeAudioContext;
    context.state = 'suspended';
    expect(playCue('tick')).toBe(true);
    expect(context.resumed).toBe(1);
  });

  it('stops listening after the first gesture, and the stopper it returns also stops it', () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const remove = vi.spyOn(target, 'removeEventListener');
    const engine = createSound({ enabled: () => false, audioContext: () => undefined });
    const stop = engine.arm(target);
    expect(add).toHaveBeenCalledTimes(4);
    target.dispatchEvent(new Event('pointerdown'));
    expect(engine.unlocked()).toBe(true);
    expect(remove).toHaveBeenCalledTimes(4);
    stop();

    const again = createSound({ enabled: () => false, audioContext: () => undefined });
    const quiet = again.arm(target);
    quiet();
    target.dispatchEvent(new Event('keydown'));
    expect(again.unlocked()).toBe(false);
  });

  it('arming twice replaces the first listener instead of stacking another', () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const remove = vi.spyOn(target, 'removeEventListener');
    const engine = createSound({ enabled: () => false, audioContext: () => undefined });
    engine.arm(target);
    engine.arm(target);
    expect(add).toHaveBeenCalledTimes(8);
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it('has nothing to arm without a window', () => {
    const engine = createSound({ enabled: () => true, audioContext: () => undefined });
    vi.stubGlobal('window', undefined);
    const stop = engine.arm();
    expect(() => stop()).not.toThrow();
    expect(engine.unlocked()).toBe(false);
  });
});

describe('playing a cue', () => {
  it('makes one context once, and one oscillator per voice, timed from the context clock', () => {
    const audio = soundOnAfterGesture();
    expect(playCue('levelUp')).toBe(true);
    expect(playCue('feat')).toBe(true);
    expect(audio.contexts).toHaveLength(1);
    const voices = CUES.levelUp.length + CUES.feat.length;
    expect(audio.oscillators()).toHaveLength(voices);
    const first = audio.oscillators()[0]!;
    expect(first.type).toBe(CUES.levelUp[0]!.wave);
    expect(first.pitches[0]).toBeCloseTo(CUES.levelUp[0]!.from, 6);
    // The cue starts just after "now" (the fake clock reads 1) and every voice stops by its end.
    expect(first.startedAt).toBeGreaterThan(1);
    for (const oscillator of audio.oscillators().slice(0, CUES.levelUp.length)) {
      expect((oscillator.stoppedAt ?? 99) - 1).toBeLessThan(MAX_CUE_SECONDS + 0.1);
    }
  });

  it('plays all nine cues without throwing, each with its own voices', () => {
    const audio = soundOnAfterGesture();
    for (const cue of CUE_NAMES) {
      const before = audio.oscillators().length;
      expect(playCue(cue), cue).toBe(true);
      expect(audio.oscillators().length - before, cue).toBe(CUES[cue].length);
    }
  });

  it('glides a voice that has a target pitch', () => {
    const audio = soundOnAfterGesture();
    playCue('lootFlip');
    const [oscillator] = audio.oscillators();
    expect(oscillator?.glide).toBe(CUES.lootFlip[0]!.to);
    playCue('tick');
    expect(audio.oscillators()[1]?.glide).toBeNull();
  });

  it('raises the pitch by the step the ticker asks for', () => {
    const audio = soundOnAfterGesture();
    playCue('tick', { step: 0 });
    playCue('tick', { step: 12 });
    const [low, high] = audio.oscillators();
    expect((high?.pitches[0] ?? 0) / (low?.pitches[0] ?? 1)).toBeCloseTo(2, 6);
  });

  it('prefers a webkit-prefixed AudioContext on an older Safari', () => {
    const audio = stubAudio();
    vi.stubGlobal('webkitAudioContext', FakeAudioContext);
    vi.stubGlobal('AudioContext', undefined);
    consent.setSound(true);
    armSound();
    gesture();
    expect(playCue('tick')).toBe(true);
    expect(audio.contexts).toHaveLength(1);
  });

  it('says false, and tries only once, in a browser with no Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    consent.setSound(true);
    armSound();
    gesture();
    expect(playCue('levelUp')).toBe(false);
    expect(playCue('levelUp')).toBe(false);
    expect(sound.started()).toBe(false);
  });

  it('says false, never throws, when the browser refuses to build a context', () => {
    class Refusing {
      constructor() {
        throw new Error('NotAllowedError');
      }
    }
    vi.stubGlobal('AudioContext', Refusing);
    consent.setSound(true);
    armSound();
    expect(() => gesture()).not.toThrow();
    expect(playCue('feat')).toBe(false);
    expect(sound.started()).toBe(false);
  });

  it('says false, never throws, when scheduling a voice fails', () => {
    const audio = soundOnAfterGesture();
    const context = audio.contexts[0] as FakeAudioContext;
    context.createOscillator = () => {
      throw new Error('InvalidStateError');
    };
    expect(playCue('mogul')).toBe(false);
  });

  it('ignores a resume that is rejected', async () => {
    const audio = soundOnAfterGesture();
    const context = audio.contexts[0] as FakeAudioContext;
    context.state = 'suspended';
    context.resume = () => Promise.reject(new Error('NotAllowedError'));
    expect(playCue('tick')).toBe(true);
    await Promise.resolve();
  });

  it('closes its context and waits for a new gesture when reset', () => {
    const audio = soundOnAfterGesture();
    playCue('tick');
    const context = audio.contexts[0] as FakeAudioContext;
    sound.reset();
    expect(context.closed).toBe(true);
    expect(sound.started()).toBe(false);
    expect(sound.unlocked()).toBe(false);
    expect(playCue('tick')).toBe(false);
  });
});

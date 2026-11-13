import { vi } from 'vitest';
import { consent } from '../lib/consent';
import { armSound, CUE_NAMES, CUES } from '../lib/sound';
import type { CueName } from '../lib/sound';

/** One oscillator as a cue created it: the pitch it was set to, its wave, and when it starts and stops. */
export interface FakeOscillator {
  type: string;
  /** The frequencies passed to `setValueAtTime`, in order (the first is the starting pitch). */
  pitches: number[];
  /** The glide target passed to `exponentialRampToValueAtTime`, if any. */
  glide: number | null;
  startedAt: number | null;
  stoppedAt: number | null;
  frequency: {
    setValueAtTime: (value: number) => void;
    exponentialRampToValueAtTime: (value: number) => void;
  };
  connect: () => void;
  start: (when: number) => void;
  stop: (when: number) => void;
}

/** What a test learns about the audio a page made. */
export interface FakeAudio {
  /** Every `AudioContext` constructed. */
  contexts: FakeAudioContext[];
  /** Every oscillator of every context, in the order they were made. */
  oscillators: () => FakeOscillator[];
}

/**
 * A stand-in for `AudioContext` that records what a cue asks of it. jsdom has no Web Audio, so without this
 * a test could only ever see "nothing happened".
 */
export class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  state: AudioContextState = 'running';
  currentTime = 1;
  destination = {};
  resumed = 0;
  closed = false;
  made: FakeOscillator[] = [];

  constructor() {
    FakeAudioContext.created.push(this);
  }

  createGain() {
    return {
      gain: {
        value: 0,
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    };
  }

  createOscillator(): FakeOscillator {
    const oscillator: FakeOscillator = {
      type: 'sine',
      pitches: [],
      glide: null,
      startedAt: null,
      stoppedAt: null,
      frequency: {
        setValueAtTime: (value) => {
          oscillator.pitches.push(value);
        },
        exponentialRampToValueAtTime: (value) => {
          oscillator.glide = value;
        },
      },
      connect: () => {},
      start: (when) => {
        oscillator.startedAt = when;
      },
      stop: (when) => {
        oscillator.stoppedAt = when;
      },
    };
    this.made.push(oscillator);
    return oscillator;
  }

  resume() {
    this.resumed += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

/** Replace the browser's `AudioContext` with the recording one. Undone by `vi.unstubAllGlobals()`. */
export function stubAudio(): FakeAudio {
  FakeAudioContext.created = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  return {
    contexts: FakeAudioContext.created,
    oscillators: () => FakeAudioContext.created.flatMap((context) => context.made),
  };
}

/**
 * The cues that were played, in order, read back from the oscillators they made: a cue is the run of voices
 * with its waves and pitches (all raised by the same number of semitones, as the score ticker does).
 */
export function cuesHeard(audio: FakeAudio): CueName[] {
  const made = audio.oscillators();
  // Longest first, so a short cue never matches the front of a longer one.
  const names = [...CUE_NAMES].sort((a, b) => CUES[b].length - CUES[a].length);
  const heard: CueName[] = [];
  let at = 0;
  while (at < made.length) {
    const found = names.find((name) => {
      const voices = CUES[name];
      const ratio = (made[at]?.pitches[0] ?? 0) / (voices[0]?.from ?? 1);
      // A transposed cue is raised by a whole number of semitones, from 0 to an octave.
      const steps = 12 * Math.log2(ratio);
      if (!(steps > -1e-6 && steps < 12 + 1e-6) || Math.abs(steps - Math.round(steps)) > 1e-6) {
        return false;
      }
      return voices.every((voice, index) => {
        const oscillator = made[at + index];
        return (
          oscillator?.type === voice.wave &&
          Math.abs((oscillator.pitches[0] ?? 0) - voice.from * ratio) < 1e-6
        );
      });
    });
    if (!found) {
      throw new Error(`oscillator ${at} belongs to no cue`);
    }
    heard.push(found);
    at += CUES[found].length;
  }
  return heard;
}

/** The semitone step of every tick heard, 0 to 12: how far the score ticker had climbed. */
export function tickSteps(audio: FakeAudio): number[] {
  const base = CUES.tick[0]?.from ?? 1;
  return audio
    .oscillators()
    .filter((oscillator) => oscillator.type === CUES.tick[0]?.wave)
    .map((oscillator) => Math.round(12 * Math.log2((oscillator.pitches[0] ?? base) / base)));
}

/** Touch the page the way a person does, so the sound engine may start. */
export function gesture(
  type: 'pointerdown' | 'keydown' | 'touchstart' | 'click' = 'pointerdown',
): void {
  window.dispatchEvent(new Event(type, { bubbles: true }));
}

/**
 * The player has turned sound on, the engine is listening, and a gesture has happened: the state a real
 * session is in a moment after "Play sound effects" is switched on. Returns what the page makes.
 */
export function soundOnAfterGesture(): FakeAudio {
  const audio = stubAudio();
  consent.setSound(true);
  armSound();
  gesture();
  return audio;
}

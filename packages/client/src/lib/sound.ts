/**
 * Opt-in sound (game-design.md sections 3 and 9, Requirement 10.5): nine short cues, synthesised in the
 * browser with the Web Audio API. There are no audio files, so there is nothing to license, download or
 * cache; docs/credits.md says so.
 *
 * The rules, each of them tested in `sound.test.ts`:
 * - **Off by default.** A cue plays only when the player turned sound on in Settings (`consent.sound`). The
 *   choice is never inferred from the browser or the operating system, so a visitor who prefers reduced
 *   motion hears nothing unless they switched sound on themselves.
 * - **Nothing is created while sound is off.** The `AudioContext` is built on the first cue that is allowed
 *   to play, never before: with sound off, no audio object exists at all.
 * - **Only after a gesture.** Browsers refuse audio until the person has touched the page. `armSound` listens
 *   for the first pointer press, key press, touch or click; a cue asked for before that is dropped, not
 *   queued, so nothing ever plays late.
 * - **Short and quiet.** Every cue is under a second and a half at a master gain of about a fifth.
 *
 * A cue is plain data (`CUES`): a handful of oscillator "voices", each with a start time, a length, a pitch
 * (optionally gliding) and a level. That keeps the sounds reviewable as text and lets a test measure them.
 */
import { soundAllowed } from './consent';

/** One cue per moment of game-design.md section 9, plus the shop, the act clear and the expedition's return. */
export const CUE_NAMES = [
  'tick',
  'levelUp',
  'lootFlip',
  'lootGlint',
  'feat',
  'mogul',
  'purchase',
  'actClear',
  'expeditionReturn',
] as const;

export type CueName = (typeof CUE_NAMES)[number];

/** One tone of a cue: an oscillator with a quick attack and an exponential decay. */
export interface Voice {
  /** Seconds after the cue starts. */
  start: number;
  /** Seconds the tone lasts. */
  length: number;
  /** Hz at the start. */
  from: number;
  /** Hz at the end, for a glide; absent for a steady pitch. */
  to?: number;
  wave: OscillatorType;
  /** Peak level, 0 to 1, before the master gain. */
  gain: number;
}

/** Master level: the whole sound is deliberately quiet. */
export const MASTER_GAIN = 0.2;

/** The longest any cue may last, in seconds. */
export const MAX_CUE_SECONDS = 1.5;

/** Equal-tempered notes, as Hz. */
const NOTE = {
  G3: 196,
  C4: 261.63,
  G4: 392,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  B5: 987.77,
  C6: 1046.5,
  E6: 1318.5,
  G6: 1568,
} as const;

export const CUES: Readonly<Record<CueName, readonly Voice[]>> = {
  // The score ticker: a soft click for each term; the ticker raises the pitch with each step.
  tick: [{ start: 0, length: 0.05, from: NOTE.G5, wave: 'triangle', gain: 0.5 }],
  // Level up: four rising notes and a held top note.
  levelUp: [
    { start: 0, length: 0.12, from: NOTE.C5, wave: 'square', gain: 0.3 },
    { start: 0.1, length: 0.12, from: NOTE.E5, wave: 'square', gain: 0.3 },
    { start: 0.2, length: 0.12, from: NOTE.G5, wave: 'square', gain: 0.3 },
    { start: 0.3, length: 0.5, from: NOTE.C6, wave: 'square', gain: 0.3 },
    { start: 0.3, length: 0.6, from: NOTE.C6, wave: 'sine', gain: 0.35 },
  ],
  // A card turning over: a short downward chirp.
  lootFlip: [{ start: 0, length: 0.08, from: 520, to: 260, wave: 'triangle', gain: 0.45 }],
  // A rare card glinting: two bright, quick sparkles.
  lootGlint: [
    { start: 0, length: 0.18, from: NOTE.E6, wave: 'sine', gain: 0.35 },
    { start: 0.07, length: 0.22, from: NOTE.G6, wave: 'sine', gain: 0.3 },
  ],
  // A Feat unlocking: a three-note fanfare and a chord.
  feat: [
    { start: 0, length: 0.12, from: NOTE.G4, wave: 'square', gain: 0.28 },
    { start: 0.12, length: 0.12, from: NOTE.C5, wave: 'square', gain: 0.28 },
    { start: 0.24, length: 0.12, from: NOTE.E5, wave: 'square', gain: 0.28 },
    { start: 0.36, length: 0.7, from: NOTE.G5, wave: 'sine', gain: 0.35 },
    { start: 0.36, length: 0.7, from: NOTE.C5, wave: 'triangle', gain: 0.3 },
  ],
  // A Mogul rising: a low sliding growl under a deep pulse.
  mogul: [
    { start: 0, length: 0.8, from: 110, to: 73, wave: 'sawtooth', gain: 0.3 },
    { start: 0.1, length: 0.9, from: 55, wave: 'triangle', gain: 0.5 },
  ],
  // A purchase: the coin, two quick bright notes.
  purchase: [
    { start: 0, length: 0.07, from: NOTE.B5, wave: 'square', gain: 0.25 },
    { start: 0.07, length: 0.3, from: NOTE.E6, wave: 'square', gain: 0.25 },
  ],
  // An act clear: three notes up and a held fifth.
  actClear: [
    { start: 0, length: 0.14, from: NOTE.C5, wave: 'triangle', gain: 0.4 },
    { start: 0.13, length: 0.14, from: NOTE.G5, wave: 'triangle', gain: 0.4 },
    { start: 0.26, length: 0.5, from: NOTE.C6, wave: 'triangle', gain: 0.4 },
    { start: 0.26, length: 0.5, from: NOTE.G5, wave: 'sine', gain: 0.25 },
  ],
  // The expedition coming home: a two-note horn call.
  expeditionReturn: [
    { start: 0, length: 0.22, from: NOTE.G4, wave: 'sawtooth', gain: 0.2 },
    { start: 0.22, length: 0.5, from: NOTE.C5, wave: 'sawtooth', gain: 0.2 },
    { start: 0.22, length: 0.5, from: NOTE.C4, wave: 'triangle', gain: 0.35 },
  ],
};

/** How long a cue lasts: the end of its last voice, in seconds. */
export function cueSeconds(cue: CueName): number {
  return Math.max(...CUES[cue].map((voice) => voice.start + voice.length));
}

/** Frequency ratio of `steps` equal-tempered semitones. */
export function semitones(steps: number): number {
  return Math.pow(2, steps / 12);
}

export interface PlayOptions {
  /** Semitones to raise the pitch by; the score ticker climbs with each term. */
  step?: number;
}

/** What the engine needs from the page. Tests replace all of it. */
export interface SoundDeps {
  /** True when the player turned sound on. */
  enabled: () => boolean;
  /** The `AudioContext` constructor, or undefined when the browser has none. */
  audioContext: () => (new () => AudioContext) | undefined;
}

export interface SoundEngine {
  /** Start listening for the first gesture. Returns a function that stops listening. */
  arm(target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): () => void;
  /** Play a cue. Returns true when it was scheduled; false when sound is off, locked, or unsupported. */
  play(cue: CueName, options?: PlayOptions): boolean;
  /** True once the person has touched the page. */
  unlocked(): boolean;
  /** Whether an `AudioContext` has been created. */
  started(): boolean;
  /** Back to the start: close the context and wait for a new gesture. For tests. */
  reset(): void;
}

/**
 * The events that count as a gesture for the autoplay rules of browsers. A click is listed too, because
 * assistive technology activates a control with a click alone, without the press that normally precedes it.
 */
const GESTURES = ['pointerdown', 'keydown', 'touchstart', 'click'] as const;

export function createSound(deps: SoundDeps): SoundEngine {
  let unlocked = false;
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let failed = false;
  let disarm: (() => void) | null = null;

  /** The one context, created on first need. Null when the browser has none or refused. */
  function ensure(): AudioContext | null {
    if (context) {
      return context;
    }
    if (failed) {
      return null;
    }
    const Ctor = deps.audioContext();
    if (!Ctor) {
      failed = true;
      return null;
    }
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(context.destination);
      return context;
    } catch {
      context = null;
      master = null;
      failed = true;
      return null;
    }
  }

  function schedule(ctx: AudioContext, cue: CueName, ratio: number): void {
    const origin = ctx.currentTime + 0.005;
    for (const voice of CUES[cue]) {
      const begin = origin + voice.start;
      const end = begin + voice.length;
      const oscillator = ctx.createOscillator();
      const level = ctx.createGain();
      oscillator.type = voice.wave;
      oscillator.frequency.setValueAtTime(voice.from * ratio, begin);
      if (voice.to !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(voice.to * ratio, end);
      }
      // A 5 ms attack so a tone never clicks, then an exponential fall to near silence.
      level.gain.setValueAtTime(0.0001, begin);
      level.gain.linearRampToValueAtTime(voice.gain, begin + 0.005);
      level.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(level);
      level.connect(master ?? ctx.destination);
      oscillator.start(begin);
      oscillator.stop(end + 0.02);
    }
  }

  return {
    arm(target = globalThis.window) {
      disarm?.();
      if (!target) {
        return () => {};
      }
      const onGesture = () => {
        unlocked = true;
        stop();
        // Prepare inside the gesture, which is when browsers allow audio to start. Only if the
        // player already asked for sound: otherwise nothing is created at all.
        if (deps.enabled()) {
          const ctx = ensure();
          if (ctx?.state === 'suspended') {
            void ctx.resume().catch(() => {});
          }
        }
      };
      const stop = () => {
        for (const name of GESTURES) {
          target.removeEventListener(name, onGesture, { capture: true });
        }
        disarm = null;
      };
      for (const name of GESTURES) {
        target.addEventListener(name, onGesture, { capture: true, passive: true });
      }
      disarm = stop;
      return stop;
    },
    play(cue, options = {}) {
      if (!deps.enabled() || !unlocked) {
        return false;
      }
      const ctx = ensure();
      if (!ctx) {
        return false;
      }
      try {
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {});
        }
        schedule(ctx, cue, semitones(options.step ?? 0));
        return true;
      } catch {
        return false;
      }
    },
    unlocked: () => unlocked,
    started: () => context !== null,
    reset() {
      disarm?.();
      void context?.close?.().catch(() => {});
      context = null;
      master = null;
      failed = false;
      unlocked = false;
    },
  };
}

interface WindowWithWebkitAudio {
  AudioContext?: new () => AudioContext;
  webkitAudioContext?: new () => AudioContext;
}

/** The app's one engine. */
export const sound: SoundEngine = createSound({
  enabled: soundAllowed,
  audioContext: () => {
    const scope = globalThis as unknown as WindowWithWebkitAudio;
    return scope.AudioContext ?? scope.webkitAudioContext;
  },
});

/** Listen for the first gesture; `main.ts` calls it once at start-up. */
export function armSound(): () => void {
  return sound.arm();
}

/** Play a cue if sound is on and the page has been touched. Never throws. */
export function playCue(cue: CueName, options?: PlayOptions): boolean {
  return sound.play(cue, options);
}

/**
 * Is a cue worth scheduling right now? Components that would set a timer only to play a cue ask first, so
 * with sound off they set no extra timers at all.
 */
export function soundOn(): boolean {
  return soundAllowed();
}

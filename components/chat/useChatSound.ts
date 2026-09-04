'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * The chime that plays when a message arrives.
 *
 * ── One sound, and it is not a file ──────────────────────────────────────
 * Two sine tones — 880Hz then 1320Hz, ninety milliseconds each — synthesised
 * in the browser with WebAudio. Nothing is downloaded, nothing is cached,
 * nothing has to be served, and it works with the network down.
 *
 * That is also why there is no *choice* of sound. A picker means a set of audio
 * files to ship and cache-bust, a settings screen to host it, and a preference
 * column to store it — for a decision nobody wants to make twice. There is one
 * chime and a switch to silence it.
 *
 * ── The envelope is the whole difference between a chime and a click ─────
 * A raw oscillator started and stopped at full gain produces a discontinuity at
 * both ends, which a speaker reproduces as a click far more noticeable than the
 * tone itself. `gain` ramps up over 12ms and decays exponentially, so what is
 * heard is the note.
 *
 * `exponentialRampToValueAtTime` cannot reach zero — it throws on a zero
 * target — so the decay runs to a small positive value and the node is stopped
 * after it, which is inaudible.
 *
 * ── Browsers refuse audio before a gesture, and that is not an error ─────
 * An `AudioContext` created on mount begins `suspended` and, on some browsers,
 * counts against the page's autoplay budget. So it is created lazily on the
 * first real user gesture and kept; before that, playing is a silent no-op.
 *
 * Nothing here logs. A refused `resume()` is the browser working correctly, and
 * a console warning every time somebody loads a chat screen without having
 * clicked yet is noise that trains people to ignore the console.
 */

/** The two notes, in Hz, and how long each is held. */
const NOTES: ReadonlyArray<{ frequency: number; durationMs: number }> = [
  { frequency: 880, durationMs: 90 },
  { frequency: 1320, durationMs: 90 },
];

/** Peak gain. Deliberately quiet: this plays in a staff room and a classroom. */
const PEAK_GAIN = 0.12;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;

  const win = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };

  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export interface UseChatSoundResult {
  /** Plays the chime, if enabled and the browser has let us have a context. */
  play: () => void;
  /** Call from a real user gesture so the context exists before it is needed. */
  arm: () => void;
}

export function useChatSound(enabled: boolean): UseChatSoundResult {
  const contextRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const arm = useCallback(() => {
    if (contextRef.current !== null) return;

    const Ctor = audioContextCtor();
    if (Ctor === null) return;

    try {
      contextRef.current = new Ctor();
    } catch {
      // A browser that will not give us a context simply has no sound.
    }
  }, []);

  const play = useCallback(() => {
    if (!enabledRef.current) return;

    const context = contextRef.current;
    if (context === null) return;

    try {
      // Suspended is the ordinary state before a gesture; resuming is allowed
      // once one has happened, and the promise rejecting is not an error worth
      // reporting.
      if (context.state === 'suspended') {
        void context.resume().catch(() => undefined);
      }

      let startAt = context.currentTime;

      for (const note of NOTES) {
        const seconds = note.durationMs / 1000;

        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(note.frequency, startAt);

        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, startAt + 0.012);
        // Never to zero — `exponentialRampToValueAtTime` throws on a zero
        // target. This lands inaudibly low and the node stops immediately after.
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(startAt);
        oscillator.stop(startAt + seconds + 0.01);

        startAt += seconds;
      }
    } catch {
      // Audio is a courtesy. It never breaks the screen it is attached to.
    }
  }, []);

  useEffect(
    () => () => {
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    },
    [],
  );

  return { play, arm };
}

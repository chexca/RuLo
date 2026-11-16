/**
 * Web Audio sound cue engine for Rulo ERG.
 * Provides clean synthesized tones for interval countdowns, block transitions,
 * and workout completion fanfare.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    if (!audioCtx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Plays a short clean beep for countdowns at 3, 2, 1 seconds.
 * 3 and 2s are played at a neutral pitch (587 Hz / D5); 1s is played at a higher pitch (880 Hz / A5).
 */
export function playCountdownBeep(secondsLeft: number): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const isFinalSecond = secondsLeft <= 1;
    const freq = isFinalSecond ? 880 : 587.33; // A5 or D5
    const duration = isFinalSecond ? 0.22 : 0.12;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    // Smooth envelope to prevent clicks
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // Audio autoplay or device failure ignored safely
  }
}

/**
 * Plays a two-note transition tone when moving between workout blocks:
 *  - Ascending (C5 -> G5) if the upcoming block is harder.
 *  - Descending (E5 -> A4) if entering a recovery/easier block.
 */
export function playBlockChangeTone(isHarder: boolean): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (isHarder) {
      // Ascending two notes: C5 (523.25 Hz) -> G5 (783.99 Hz)
      playTone(ctx, 523.25, now, 0.14, 0.25);
      playTone(ctx, 783.99, now + 0.13, 0.22, 0.28);
    } else {
      // Gentle descending two notes: E5 (659.25 Hz) -> A4 (440 Hz)
      playTone(ctx, 659.25, now, 0.16, 0.20);
      playTone(ctx, 440.0, now + 0.14, 0.28, 0.18);
    }
  } catch {
    // Safely ignore
  }
}

/**
 * Plays a triumphant 3-note major arpeggio (C5 -> E5 -> G5) when the workout is finished.
 */
export function playWorkoutCompleteFanfare(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // C Major Arpeggio: C5 (523.25), E5 (659.25), G5 (783.99)
    playTone(ctx, 523.25, now, 0.16, 0.25);
    playTone(ctx, 659.25, now + 0.16, 0.16, 0.25);
    playTone(ctx, 783.99, now + 0.32, 0.45, 0.30);
  } catch {
    // Safely ignore
  }
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  peakGain = 0.25
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle'; // Warmer, rounder tone than pure sine or harsh square
  osc.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration);
}

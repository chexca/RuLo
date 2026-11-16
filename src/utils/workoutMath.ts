import type { Workout, WorkoutBlock, PowerUnit } from '../types/workout';

export interface PowerZoneInfo {
  zone: number;
  code: string;
  name: string;
  color: string;
}

/**
 * Resolves a power value (either absolute Watts or percentage of FTP) into integer Watts.
 */
export function resolveWatts(value: number, unit: PowerUnit, ftp: number): number {
  if (unit === 'watts') {
    return Math.round(value);
  }
  return Math.round((value / 100) * ftp);
}

/**
 * Returns Coggan 6-zone classification for given Watts and FTP.
 * Coggan 6 zones based on pct = (watts / Math.max(1, ftp)) * 100:
 *  - < 55%: Z1 Recuperación (#64748b)
 *  - < 76%: Z2 Resistencia (#3b82f6)
 *  - < 91%: Z3 Tempo / Sweet Spot (#10b981)
 *  - < 106%: Z4 Umbral (FTP) (#eab308)
 *  - < 121%: Z5 VO2max (#f97316)
 *  - >= 121%: Z6 Anaeróbico (#ef4444)
 */
export function getPowerZone(watts: number, ftp: number): PowerZoneInfo {
  const safeFtp = Math.max(1, ftp);
  const pct = (watts / safeFtp) * 100;

  if (pct < 55) {
    return { zone: 1, code: 'Z1', name: 'Recuperación', color: '#64748b' };
  }
  if (pct < 76) {
    return { zone: 2, code: 'Z2', name: 'Resistencia', color: '#3b82f6' };
  }
  if (pct < 91) {
    return { zone: 3, code: 'Z3', name: 'Tempo / Sweet Spot', color: '#10b981' };
  }
  if (pct < 106) {
    return { zone: 4, code: 'Z4', name: 'Umbral (FTP)', color: '#eab308' };
  }
  if (pct < 121) {
    return { zone: 5, code: 'Z5', name: 'VO2max', color: '#f97316' };
  }
  return { zone: 6, code: 'Z6', name: 'Anaeróbico', color: '#ef4444' };
}

export interface WorkoutProgressSnapshot {
  targetWatts: number;
  baseTargetWatts: number;
  blockIndex: number;
  block: WorkoutBlock | null;
  nextBlock: WorkoutBlock | null;
  blockElapsedSec: number;
  blockRemainingSec: number;
  totalDurationSec: number;
  sessionElapsedSec: number;
  sessionRemainingSec: number;
  finished: boolean;
}

/**
 * Computes snapshot state of a workout at a given elapsed second.
 * Linearly interpolates power for ramps, resolves units, adds biasWatts (clamped >= 30W when riding),
 * and computes remaining/elapsed metrics.
 */
export function getWorkoutSnapshotAtSecond(
  workout: Workout,
  elapsedSec: number,
  ftp: number,
  biasWatts?: number
): WorkoutProgressSnapshot {
  const blocks = workout.blocks ?? [];
  const totalDurationSec = blocks.reduce((acc, b) => acc + Math.max(0, b.durationSec || 0), 0);
  const safeElapsed = Math.max(0, elapsedSec);

  if (blocks.length === 0 || safeElapsed >= totalDurationSec) {
    return {
      targetWatts: 0,
      baseTargetWatts: 0,
      blockIndex: -1,
      block: null,
      nextBlock: null,
      blockElapsedSec: 0,
      blockRemainingSec: 0,
      totalDurationSec,
      sessionElapsedSec: safeElapsed,
      sessionRemainingSec: 0,
      finished: true
    };
  }

  let accumulated = 0;
  let blockIndex = -1;
  let activeBlock: WorkoutBlock = blocks[0];
  let blockElapsedSec = 0;
  let blockRemainingSec = 0;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const duration = Math.max(0, b.durationSec || 0);
    const end = accumulated + duration;

    if (safeElapsed < end || i === blocks.length - 1) {
      blockIndex = i;
      activeBlock = b;
      blockElapsedSec = safeElapsed - accumulated;
      blockRemainingSec = Math.max(0, duration - blockElapsedSec);
      break;
    }
    accumulated = end;
  }

  const nextBlock = blockIndex + 1 < blocks.length ? blocks[blockIndex + 1] : null;

  // Compute power value
  let rawPower = activeBlock.powerStart;
  if (activeBlock.type === 'ramp') {
    const dur = Math.max(1, activeBlock.durationSec);
    const progress = Math.min(1, Math.max(0, blockElapsedSec / dur));
    rawPower = activeBlock.powerStart + (activeBlock.powerEnd - activeBlock.powerStart) * progress;
  }

  const baseTargetWatts = resolveWatts(rawPower, activeBlock.unit, ftp);
  const bias = biasWatts ?? 0;
  // Clamped >= 30 when riding
  const targetWatts = Math.max(30, baseTargetWatts + bias);
  const sessionRemainingSec = Math.max(0, totalDurationSec - safeElapsed);

  return {
    targetWatts,
    baseTargetWatts,
    blockIndex,
    block: activeBlock,
    nextBlock,
    blockElapsedSec,
    blockRemainingSec,
    totalDurationSec,
    sessionElapsedSec: safeElapsed,
    sessionRemainingSec,
    finished: false
  };
}

export interface WorkoutStats {
  totalDurationSec: number;
  avgWatts: number;
  maxWatts: number;
  normalizedPower: number;
  intensityFactor: number;
  tss: number;
}

/**
 * Computes workout statistics: totalDuration, avgWatts, maxWatts,
 * 30-second rolling 4th-power Normalized Power (NP), Intensity Factor (IF), and TSS.
 */
export function computeWorkoutStats(workout: Workout, ftp: number): WorkoutStats {
  const blocks = workout.blocks ?? [];
  const totalDurationSec = blocks.reduce((acc, b) => acc + Math.max(0, b.durationSec || 0), 0);

  if (totalDurationSec <= 0 || blocks.length === 0) {
    return {
      totalDurationSec: 0,
      avgWatts: 0,
      maxWatts: 0,
      normalizedPower: 0,
      intensityFactor: 0,
      tss: 0
    };
  }

  const powers = new Float64Array(totalDurationSec);
  let sumWatts = 0;
  let maxWatts = 0;

  for (let s = 0; s < totalDurationSec; s++) {
    const snap = getWorkoutSnapshotAtSecond(workout, s, ftp, 0);
    const w = snap.targetWatts;
    powers[s] = w;
    sumWatts += w;
    if (w > maxWatts) {
      maxWatts = w;
    }
  }

  const avgWatts = Math.round(sumWatts / totalDurationSec);

  // Coggan 30-second rolling average 4th-power Normalized Power (NP)
  let normalizedPower: number;
  if (totalDurationSec < 30) {
    normalizedPower = avgWatts;
  } else {
    let windowSum = 0;
    for (let i = 0; i < 30; i++) {
      windowSum += powers[i];
    }
    let sum4th = Math.pow(windowSum / 30, 4);
    let count = 1;

    for (let i = 30; i < totalDurationSec; i++) {
      windowSum += powers[i] - powers[i - 30];
      sum4th += Math.pow(windowSum / 30, 4);
      count++;
    }

    normalizedPower = Math.round(Math.pow(sum4th / count, 0.25));
  }

  const safeFtp = Math.max(1, ftp);
  const intensityFactor = Number((normalizedPower / safeFtp).toFixed(2));
  const tss = Math.round(((totalDurationSec * normalizedPower * (normalizedPower / safeFtp)) / (safeFtp * 3600)) * 100);

  return {
    totalDurationSec,
    avgWatts,
    maxWatts,
    normalizedPower,
    intensityFactor,
    tss
  };
}

/**
 * Formats time in seconds:
 *  - >= 3600 -> "H:MM:SS"
 *  - < 3600 -> "MM:SS"
 *  - < 0 -> "00:00"
 */
export function formatTime(totalSeconds: number): string {
  if (totalSeconds < 0 || isNaN(totalSeconds)) {
    return '00:00';
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

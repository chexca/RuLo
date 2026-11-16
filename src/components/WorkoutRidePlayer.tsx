import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Square,
  Volume2,
  VolumeX,
  Radio,
  Bluetooth,
  Cpu,
  Unlink,
  CheckCircle2,
  Download,
  Activity,
  Heart,
  Gauge,
  Compass,
  ArrowRight,
  TrendingUp,
  X,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import {
  Workout,
  TrainerTelemetry,
  RecordedSample,
  ConnectionTransport,
  ConnectionStatus,
} from '../types/workout';
import {
  getWorkoutSnapshotAtSecond,
  getPowerZone,
  formatTime,
  WorkoutProgressSnapshot,
} from '../utils/workoutMath';
import { WorkoutChart } from './WorkoutChart';
import {
  playCountdownBeep,
  playBlockChangeTone,
  playWorkoutCompleteFanfare,
} from '../services/soundCue';
import { generateTcx, generateFitBase64 } from '../services/activityExporter';

export interface WorkoutRidePlayerProps {
  workout: Workout;
  ftp: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onExit: () => void;
  telemetry: TrainerTelemetry;
  activeTransport: ConnectionTransport;
  connectionStatus: ConnectionStatus;
  deviceName?: string;
  onOpenConnectionModal: () => void;
  sendTargetPowerToActiveTrainer: (watts: number) => Promise<void> | void;
}

export const WorkoutRidePlayer: React.FC<WorkoutRidePlayerProps> = ({
  workout,
  ftp,
  soundEnabled,
  onToggleSound,
  onExit,
  telemetry,
  activeTransport,
  connectionStatus,
  deviceName,
  onOpenConnectionModal,
  sendTargetPowerToActiveTrainer,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [biasWatts, setBiasWatts] = useState(0);
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // References to keep accurate time delta and avoid stale closures
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const elapsedSecRef = useRef(elapsedSec);
  elapsedSecRef.current = elapsedSec;

  const biasWattsRef = useRef(biasWatts);
  biasWattsRef.current = biasWatts;

  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;

  const lastSentTargetWattsRef = useRef<number | null>(null);
  const lastBlockIndexRef = useRef<number>(-1);
  const lastBeepSecRef = useRef<number>(-1);
  const lastRecordedSecRef = useRef<number>(-1);
  const lastWallTimeRef = useRef<number | null>(null);

  // Compute total duration of workout
  const totalDurationSec = useMemo(() => {
    return (workout.blocks || []).reduce((acc, b) => acc + (b.durationSec || 0), 0);
  }, [workout]);

  // Current snapshot at current second
  const snapshot: WorkoutProgressSnapshot = useMemo(() => {
    return getWorkoutSnapshotAtSecond(workout, Math.floor(elapsedSec), ftp, biasWatts);
  }, [workout, elapsedSec, ftp, biasWatts]);

  // Cumulative block start times for seeking
  const blockStartTimes = useMemo(() => {
    let t = 0;
    return (workout.blocks || []).map((b) => {
      const start = t;
      t += b.durationSec || 0;
      return start;
    });
  }, [workout]);

  // Sync target power with active trainer when targetWatts or playing status changes
  useEffect(() => {
    if (isPlaying) {
      if (lastSentTargetWattsRef.current !== snapshot.targetWatts) {
        lastSentTargetWattsRef.current = snapshot.targetWatts;
        sendTargetPowerToActiveTrainer(snapshot.targetWatts);
      }
    } else {
      // When paused or stopped, send a safe 100W resistance
      if (lastSentTargetWattsRef.current !== 100) {
        lastSentTargetWattsRef.current = 100;
        sendTargetPowerToActiveTrainer(100);
      }
    }
  }, [isPlaying, snapshot.targetWatts, sendTargetPowerToActiveTrainer]);

  // Main 1-Second Workout Engine Loop using wall-clock delta tracking
  useEffect(() => {
    if (!isPlaying || isFinished) {
      lastWallTimeRef.current = null;
      return;
    }

    lastWallTimeRef.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const last = lastWallTimeRef.current || now;
      const deltaSec = (now - last) / 1000;
      lastWallTimeRef.current = now;

      setElapsedSec((prevElapsed) => {
        const nextElapsed = prevElapsed + deltaSec;
        const currentSec = Math.floor(nextElapsed);

        // Compute snapshot for this second
        const currentSnapshot = getWorkoutSnapshotAtSecond(
          workout,
          currentSec,
          ftp,
          biasWattsRef.current
        );

        // Sound cue: Countdown beeps at 3, 2, 1 seconds left in current block
        if (
          soundEnabled &&
          currentSnapshot.blockRemainingSec <= 3 &&
          currentSnapshot.blockRemainingSec >= 1 &&
          lastBeepSecRef.current !== currentSnapshot.blockRemainingSec
        ) {
          lastBeepSecRef.current = currentSnapshot.blockRemainingSec;
          playCountdownBeep(currentSnapshot.blockRemainingSec);
        }

        // Sound cue: Block change tone
        if (
          lastBlockIndexRef.current !== -1 &&
          currentSnapshot.blockIndex !== lastBlockIndexRef.current &&
          !currentSnapshot.finished
        ) {
          const prevTarget = lastSentTargetWattsRef.current || ftp;
          const isHarder = currentSnapshot.targetWatts >= prevTarget;
          if (soundEnabled) {
            playBlockChangeTone(isHarder);
          }
        }
        lastBlockIndexRef.current = currentSnapshot.blockIndex;

        // Sound cue & completion when workout reaches total duration
        if (currentSnapshot.finished || nextElapsed >= totalDurationSec) {
          setIsPlaying(false);
          setIsFinished(true);
          if (soundEnabled) {
            playWorkoutCompleteFanfare();
          }
          return totalDurationSec;
        }

        // Append recorded telemetry sample strictly once per integer second (1 Hz for Strava/Garmin TCX & FIT)
        if (currentSec !== lastRecordedSecRef.current) {
          lastRecordedSecRef.current = currentSec;
          const curTelem = telemetryRef.current;
          setRecordedSamples((prevSamples) => [
            ...prevSamples,
            {
              timestampMs: now,
              elapsedSec: currentSec,
              powerWatts: curTelem.powerWatts || 0,
              targetWatts: currentSnapshot.targetWatts,
              cadenceRpm: curTelem.cadenceRpm || 0,
              speedKmh: curTelem.speedKmh || 0,
              distanceMeters: curTelem.distanceMeters || 0,
              heartRateBpm: curTelem.heartRateBpm,
            },
          ]);
        }

        return nextElapsed;
      });
    }, 250);

    return () => clearInterval(interval);
  }, [isPlaying, isFinished, workout, ftp, totalDurationSec, soundEnabled]);

  // Handlers for controls
  const handleTogglePlay = () => {
    if (isFinished) {
      // Restart if finished
      setElapsedSec(0);
      setIsFinished(false);
      setRecordedSamples([]);
      lastRecordedSecRef.current = -1;
      setIsPlaying(true);
      return;
    }
    setIsPlaying(!isPlaying);
  };

  const handleNextBlock = () => {
    const nextIdx = snapshot.blockIndex + 1;
    if (nextIdx < blockStartTimes.length) {
      setElapsedSec(blockStartTimes[nextIdx]);
      lastBeepSecRef.current = -1;
    } else {
      // Seek to finish
      setElapsedSec(totalDurationSec);
      setIsPlaying(false);
      setIsFinished(true);
      if (soundEnabled) playWorkoutCompleteFanfare();
    }
  };

  const handlePrevBlock = () => {
    const curIdx = snapshot.blockIndex;
    if (snapshot.blockElapsedSec > 3 || curIdx === 0) {
      // Restart current block
      setElapsedSec(blockStartTimes[curIdx]);
    } else if (curIdx > 0) {
      // Go to previous block
      setElapsedSec(blockStartTimes[curIdx - 1]);
    }
    lastBeepSecRef.current = -1;
  };

  const handleSeekBlock = (blockIdx: number) => {
    if (blockIdx >= 0 && blockIdx < blockStartTimes.length) {
      setElapsedSec(blockStartTimes[blockIdx]);
      lastBeepSecRef.current = -1;
    }
  };

  const handleEndEarly = () => {
    if (confirm('¿Deseas finalizar este entrenamiento ahora?')) {
      setIsPlaying(false);
      setIsFinished(true);
      if (soundEnabled) playWorkoutCompleteFanfare();
    }
  };

  // Bias wattage adjustment (+/- 5W, +/- 10W)
  const adjustBias = (delta: number) => {
    setBiasWatts((prev) => prev + delta);
  };

  const resetBias = () => {
    setBiasWatts(0);
  };

  // Export handlers
  const handleExportTcx = async () => {
    try {
      const tcxContent = generateTcx(workout.name, recordedSamples);
      const defaultFileName = `${workout.name.replace(/\s+/g, '_')}_${new Date()
        .toISOString()
        .slice(0, 10)}.tcx`;

      if (window.electronAPI?.exportActivityFile) {
        const res = await window.electronAPI.exportActivityFile({
          defaultFileName,
          tcxContent,
        });
        if (!res.canceled && !res.error) {
          setExportMessage(`Archivo .TCX guardado en: ${res.filePath || defaultFileName}`);
        } else if (res.error) {
          alert(`Error al guardar .TCX: ${res.error}`);
        }
        return;
      }

      // Browser Blob fallback
      const blob = new Blob([tcxContent], { type: 'application/vnd.garmin.tcx+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFileName;
      a.click();
      URL.revokeObjectURL(url);
      setExportMessage('Descarga .TCX iniciada.');
    } catch (err) {
      alert(`Error al generar TCX: ${(err as Error).message}`);
    }
  };

  const handleExportFit = async () => {
    try {
      const fitBase64 = generateFitBase64(workout.name, recordedSamples);
      const defaultFileName = `${workout.name.replace(/\s+/g, '_')}_${new Date()
        .toISOString()
        .slice(0, 10)}.fit`;

      if (window.electronAPI?.exportActivityFile) {
        const res = await window.electronAPI.exportActivityFile({
          defaultFileName,
          tcxContent: '',
          fitBase64,
        });
        if (!res.canceled && !res.error) {
          setExportMessage(`Archivo .FIT guardado en: ${res.filePath || defaultFileName}`);
        } else if (res.error) {
          alert(`Error al guardar .FIT: ${res.error}`);
        }
        return;
      }

      // Browser fallback base64 binary download
      const byteChars = atob(fitBase64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNums[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNums);
      const blob = new Blob([byteArray], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFileName;
      a.click();
      URL.revokeObjectURL(url);
      setExportMessage('Descarga .FIT iniciada.');
    } catch (err) {
      alert(`Error al generar FIT: ${(err as Error).message}`);
    }
  };

  // Live power delta vs target
  const currentWatts = telemetry.powerWatts || 0;
  const targetWatts = snapshot.targetWatts;
  const powerDelta = currentWatts - targetWatts;
  const zoneInfo = getPowerZone(currentWatts, ftp);

  // Block progress percentage
  const blockDuration = snapshot.block?.durationSec || 1;
  const blockProgressPct = Math.min(
    Math.max((snapshot.blockElapsedSec / blockDuration) * 100, 0),
    100
  );

  // Session progress percentage
  const sessionProgressPct = Math.min(
    Math.max((snapshot.sessionElapsedSec / (totalDurationSec || 1)) * 100, 0),
    100
  );

  // Pulse animation for last 5 seconds of the block
  const isCountdownCritical =
    isPlaying && snapshot.blockRemainingSec <= 5 && snapshot.blockRemainingSec > 0;

  // Post-workout summary calculations
  const summaryStats = useMemo(() => {
    if (recordedSamples.length === 0) return null;
    const avgW = Math.round(
      recordedSamples.reduce((acc, s) => acc + s.powerWatts, 0) / recordedSamples.length
    );
    const maxW = Math.max(...recordedSamples.map((s) => s.powerWatts));
    const avgCad = Math.round(
      recordedSamples.reduce((acc, s) => acc + s.cadenceRpm, 0) / recordedSamples.length
    );
    const lastSample = recordedSamples[recordedSamples.length - 1];
    const totalDistKm = (lastSample.distanceMeters / 1000).toFixed(2);
    const hrSamples = recordedSamples.filter((s) => s.heartRateBpm && s.heartRateBpm > 0);
    const avgHr =
      hrSamples.length > 0
        ? Math.round(hrSamples.reduce((acc, s) => acc + (s.heartRateBpm || 0), 0) / hrSamples.length)
        : null;

    return { avgW, maxW, avgCad, totalDistKm, avgHr };
  }, [recordedSamples]);

  return (
    <div className="player-container">
      {/* Top Status Bar */}
      <div className="player-top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#f8fafc' }}>
            {workout.name}
          </div>
          <span className="brand-badge">ERG ACTIVO</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Trainer Connection Pill (clickable mid-session!) */}
          <div
            className="connection-pill"
            onClick={onOpenConnectionModal}
            title="Pulsa para cambiar o reconectar el rodillo Tacx Neo 2"
          >
            <span
              className={`status-dot ${
                connectionStatus === 'connected' ? 'connected' : 'disconnected'
              }`}
            />
            {activeTransport === 'ant' ? (
              <Radio size={14} style={{ color: 'var(--accent-cyan)' }} />
            ) : activeTransport === 'ble' ? (
              <Bluetooth size={14} style={{ color: 'var(--accent-cyan)' }} />
            ) : activeTransport === 'simulator' ? (
              <Cpu size={14} style={{ color: 'var(--accent-emerald)' }} />
            ) : (
              <Unlink size={14} style={{ color: '#ef4444' }} />
            )}
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
              {connectionStatus === 'connected'
                ? deviceName || 'Tacx Neo 2'
                : 'Rodillo Desconectado'}
            </span>
          </div>

          {/* Sound Toggle */}
          <button
            className="btn btn-secondary btn-icon"
            onClick={onToggleSound}
            title={soundEnabled ? 'Avisos sonoros activados' : 'Avisos sonoros silenciados'}
          >
            {soundEnabled ? (
              <Volume2 size={18} style={{ color: 'var(--accent-cyan)' }} />
            ) : (
              <VolumeX size={18} style={{ color: 'var(--text-dim)' }} />
            )}
          </button>

          {/* Exit Ride Button */}
          <button
            className="btn btn-secondary"
            onClick={() => {
              if (isPlaying) {
                if (confirm('El entrenamiento está en curso. ¿Deseas pausar y salir?')) {
                  setIsPlaying(false);
                  onExit();
                }
              } else {
                onExit();
              }
            }}
          >
            <X size={16} /> Salir
          </button>
        </div>
      </div>

      {/* Main Cockpit Hero Grid */}
      <div className="player-cockpit-grid">
        {/* TILE 1: ACTUAL POWER & ERG TARGET */}
        <div className="cockpit-tile cockpit-tile-power">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Potencia Actual
              </span>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: `${zoneInfo.color}25`,
                  color: zoneInfo.color,
                  border: `1px solid ${zoneInfo.color}60`,
                }}
              >
                {zoneInfo.code} · {zoneInfo.name}
              </span>
            </div>

            {/* Live Delta vs Target */}
            <div
              style={{
                fontSize: '0.9rem',
                fontWeight: 700,
                color: Math.abs(powerDelta) <= 5 ? '#10b981' : powerDelta > 0 ? '#38bdf8' : '#f59e0b',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {powerDelta >= 0 ? `+${powerDelta}` : powerDelta} W vs obj
            </div>
          </div>

          {/* Enormous Current Watts Display */}
          <div style={{ display: 'flex', alignItems: 'baseline', margin: '4px 0' }}>
            <div className="power-hero-num">{currentWatts}</div>
            <span className="power-unit-label">W</span>
          </div>

          {/* ERG Target Power & Bias Control */}
          <div
            style={{
              padding: '12px 14px',
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid #1e293b',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                OBJETIVO ERG TACX
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                {targetWatts}{' '}
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  W ({Math.round((targetWatts / ftp) * 100)}% FTP)
                </span>
              </div>
            </div>

            {/* Quick bias buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => adjustBias(-10)}
                title="Reducir 10 vatios"
              >
                -10
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => adjustBias(-5)}
                title="Reducir 5 vatios"
              >
                -5
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => adjustBias(5)}
                title="Añadir 5 vatios"
              >
                +5
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                onClick={() => adjustBias(10)}
                title="Añadir 10 vatios"
              >
                +10
              </button>
              {biasWatts !== 0 && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 6px', fontSize: '0.75rem', color: '#f59e0b' }}
                  onClick={resetBias}
                  title="Restablecer bias a 0W"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* TILE 2: BLOCK COUNTDOWN & NEXT SECTOR */}
        <div className={`cockpit-tile ${isCountdownCritical ? 'pulse-alert' : ''}`}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Tiempo Restante Bloque
              </span>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                Bloque {snapshot.blockIndex + 1} de {workout.blocks.length}
              </span>
            </div>

            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', marginTop: 4 }}>
              {snapshot.block?.label || (snapshot.block?.type === 'ramp' ? 'Rampa' : 'Intervalo Fijo')}
            </div>

            {/* Countdown Hero Number */}
            <div className="countdown-hero">
              {formatTime(snapshot.blockRemainingSec)}
            </div>

            {/* Sector Progress Bar */}
            <div
              style={{
                width: '100%',
                height: '8px',
                background: '#1e293b',
                borderRadius: '4px',
                overflow: 'hidden',
                margin: '8px 0 16px',
              }}
            >
              <div
                style={{
                  width: `${blockProgressPct}%`,
                  height: '100%',
                  background: isCountdownCritical
                    ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                    : 'linear-gradient(90deg, #0284c7, #38bdf8)',
                  transition: 'width 0.25s linear',
                }}
              />
            </div>
          </div>

          {/* Next Block Preview */}
          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ArrowRight size={14} style={{ color: 'var(--text-dim)' }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                Siguiente sector:
              </span>
            </div>

            {snapshot.nextBlock ? (
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>
                {snapshot.nextBlock.label || (snapshot.nextBlock.type === 'ramp' ? 'Rampa' : 'Fijo')}{' '}
                · {formatTime(snapshot.nextBlock.durationSec)} @{' '}
                <span style={{ color: 'var(--accent-cyan)' }}>
                  {snapshot.nextBlock.type === 'steady'
                    ? `${snapshot.nextBlock.powerStart}${snapshot.nextBlock.unit === 'ftp_percent' ? '%' : 'W'}`
                    : `${snapshot.nextBlock.powerStart}→${snapshot.nextBlock.powerEnd}${snapshot.nextBlock.unit === 'ftp_percent' ? '%' : 'W'}`}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: '0.82rem', color: 'var(--accent-emerald)', fontWeight: 700 }}>
                ¡Último bloque! 🎉
              </span>
            )}
          </div>
        </div>

        {/* TILE 3: TOTAL SESSION REMAINING & ELAPSED */}
        <div className="cockpit-tile">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Tiempo Restante Sesión
              </span>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                {Math.round(sessionProgressPct)}% completado
              </span>
            </div>

            <div className="countdown-hero">
              {formatTime(snapshot.sessionRemainingSec)}
            </div>

            {/* Total Session Progress Bar */}
            <div
              style={{
                width: '100%',
                height: '8px',
                background: '#1e293b',
                borderRadius: '4px',
                overflow: 'hidden',
                margin: '8px 0 16px',
              }}
            >
              <div
                style={{
                  width: `${sessionProgressPct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #10b981, #06b6d4)',
                  transition: 'width 0.25s linear',
                }}
              />
            </div>
          </div>

          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(15, 23, 42, 0.65)',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Transcurrido: <strong style={{ color: '#fff' }}>{formatTime(snapshot.sessionElapsedSec)}</strong>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              Total: <strong style={{ color: '#fff' }}>{formatTime(totalDurationSec)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Metrics Strip: Cadence, Speed, Distance, Heart Rate */}
      <div className="secondary-metrics-strip">
        <div className="sec-metric-card">
          <div>
            <div className="sec-metric-unit">Cadencia</div>
            <div className="sec-metric-val">
              {telemetry.cadenceRpm || 0}
              {snapshot.block?.cadenceTarget && (
                <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginLeft: 6 }}>
                  / {snapshot.block.cadenceTarget}
                </span>
              )}
            </div>
          </div>
          <Gauge size={26} style={{ color: 'var(--accent-purple)' }} />
        </div>

        <div className="sec-metric-card">
          <div>
            <div className="sec-metric-unit">Velocidad</div>
            <div className="sec-metric-val">
              {(telemetry.speedKmh || 0).toFixed(1)}
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: 4 }}>km/h</span>
            </div>
          </div>
          <Compass size={26} style={{ color: 'var(--accent-cyan)' }} />
        </div>

        <div className="sec-metric-card">
          <div>
            <div className="sec-metric-unit">Distancia</div>
            <div className="sec-metric-val">
              {((telemetry.distanceMeters || 0) / 1000).toFixed(2)}
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: 4 }}>km</span>
            </div>
          </div>
          <TrendingUp size={26} style={{ color: 'var(--accent-emerald)' }} />
        </div>

        <div className="sec-metric-card">
          <div>
            <div className="sec-metric-unit">Pulso Cardíaco</div>
            <div className="sec-metric-val">
              {telemetry.heartRateBpm && telemetry.heartRateBpm > 0 ? (
                telemetry.heartRateBpm
              ) : (
                <span style={{ color: 'var(--text-dim)' }}>--</span>
              )}
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: 4 }}>ppm</span>
            </div>
          </div>
          <Heart
            size={26}
            style={{
              color: telemetry.heartRateBpm ? 'var(--accent-rose)' : 'var(--text-dim)',
            }}
          />
        </div>
      </div>

      {/* Live Chart Display with Active Playhead & Recorded Polyline */}
      <div style={{ padding: '0 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          className="card"
          style={{
            flex: 1,
            padding: '16px 20px',
            background: '#090d16',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <WorkoutChart
            workout={workout}
            ftp={ftp}
            elapsedSec={elapsedSec}
            recordedSamples={recordedSamples}
            activeBlockIndex={snapshot.blockIndex}
            onSeekBlock={handleSeekBlock}
            height={200}
            interactive={true}
          />
        </div>
      </div>

      {/* Player Controls Bar */}
      <div className="player-controls-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={handlePrevBlock}
            title="Sector anterior o reiniciar sector actual"
          >
            <SkipBack size={18} /> Sector Anterior
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleNextBlock}
            title="Saltar al siguiente sector"
          >
            Saltar Sector <SkipForward size={18} />
          </button>
        </div>

        {/* Center Giant Play / Pause Button */}
        <div>
          <button
            className={`btn btn-lg ${isPlaying ? 'btn-secondary' : 'btn-emerald'}`}
            style={{ minWidth: '180px', padding: '14px 32px', fontSize: '1.15rem', fontWeight: 800 }}
            onClick={handleTogglePlay}
          >
            {isPlaying ? (
              <>
                <Pause size={22} /> Pausar
              </>
            ) : isFinished ? (
              <>
                <RotateCcw size={22} /> Repetir
              </>
            ) : (
              <>
                <Play size={22} fill="currentColor" /> Iniciar Pedaleo
              </>
            )}
          </button>
        </div>

        <div>
          <button
            className="btn btn-danger"
            onClick={handleEndEarly}
            disabled={recordedSamples.length < 5 && elapsedSec < 5}
          >
            <Square size={16} /> Terminar Sesión
          </button>
        </div>
      </div>

      {/* POST-WORKOUT COMPLETION / EXPORT MODAL */}
      {isFinished && summaryStats && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '580px' }}>
            <div className="modal-header">
              <div className="modal-title">
                <CheckCircle2 size={24} style={{ color: 'var(--accent-emerald)' }} />
                <span>¡Entrenamiento Completado!</span>
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setIsFinished(false)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div
                style={{
                  textAlign: 'center',
                  padding: '12px 0 20px',
                  borderBottom: '1px solid var(--border-subtle)',
                  marginBottom: '20px',
                }}
              >
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f8fafc', marginBottom: 4 }}>
                  {workout.name}
                </h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Tiempo total completado:{' '}
                  <strong style={{ color: 'var(--accent-cyan)' }}>
                    {formatTime(Math.floor(elapsedSec))}
                  </strong>
                </div>
              </div>

              {/* Stats Summary Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '12px',
                  marginBottom: '24px',
                }}
              >
                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Vatios Medios
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>
                    {summaryStats.avgW} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>W</span>
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Vatios Máximos
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#38bdf8' }}>
                    {summaryStats.maxW} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>W</span>
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Cadencia Media
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#a78bfa' }}>
                    {summaryStats.avgCad} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>RPM</span>
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    Distancia Recorrida
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981' }}>
                    {summaryStats.totalDistKm}{' '}
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>km</span>
                  </div>
                </div>
              </div>

              {exportMessage && (
                <div className="alert-box alert-emerald" style={{ marginBottom: 16 }}>
                  <CheckCircle2 size={18} />
                  <span>{exportMessage}</span>
                </div>
              )}

              {/* Export Activity Files */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  className="btn btn-primary"
                  style={{ padding: '12px', fontSize: '0.95rem' }}
                  onClick={handleExportTcx}
                >
                  <Download size={18} /> Guardar .TCX (Strava / Garmin Connect)
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '12px', fontSize: '0.95rem' }}
                  onClick={handleExportFit}
                >
                  <Download size={18} /> Guardar .FIT
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setIsFinished(false);
                  onExit();
                }}
              >
                Volver a la Biblioteca
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

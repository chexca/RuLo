import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Radio,
  Bluetooth,
  Cpu,
  Unlink,
  CheckCircle2,
  Download,
  Heart,
  Gauge,
  Compass,
  TrendingUp,
  X,
  AlertCircle,
  RotateCcw,
  Flame,
  ScanEye,
  EyeOff,
  Timer,
  TimerOff,
  Upload,
  ExternalLink,
  Loader2,
  Zap,
  Wind,
  ChevronLeft,
  ChevronRight,
  Eye,
  PictureInPicture2,
} from 'lucide-react';
import {
  TrainerTelemetry,
  RecordedSample,
  ConnectionTransport,
  ConnectionStatus,
  SessionFieldMode,
  SessionFieldKey,
  GarminStatus,
  GarminUploadResult,
  StravaStatus,
  StravaLoginResult,
  StravaUploadResult,
} from '../types/workout';
import {
  getPowerZone,
  getPowerZoneLabel,
  getPowerZoneThresholds,
  getNextZoneMinWatts,
  getPrevZoneMinWatts,
  formatTime,
  estimateVirtualSpeedKmh,
  computeRecordedKcal,
  getHrZone,
  HrZoneInfo,
} from '../utils/workoutMath';
import { NumericInput } from './NumericInput';
import { playWorkoutCompleteFanfare } from '../services/soundCue';
import { generateTcx, generateFitBase64 } from '../services/activityExporter';
import { useI18n } from '../i18n';

export interface FreeRidePlayerProps {
  ftp: number;
  weightKg?: number;
  maxHr?: number;
  restingHr?: number;
  age?: number;
  soundEnabled: boolean;
  sessionFieldModes?: Record<string, SessionFieldMode>;
  onUpdateSessionFieldModes?: (modes: Record<string, SessionFieldMode>) => void;
  powerSmoothingSec?: 0 | 3 | 5;
  onUpdatePowerSmoothing?: (sec: 0 | 3 | 5) => void;
  onToggleSound: () => void;
  onExit: () => void;
  telemetry: TrainerTelemetry;
  activeTransport: ConnectionTransport;
  connectionStatus: ConnectionStatus;
  deviceName?: string;
  onOpenConnectionModal: () => void;
  sendTargetPowerToActiveTrainer: (watts: number) => Promise<void> | void;
  garminStatus?: GarminStatus;
  autoUploadGarmin?: boolean;
  onGarminLogin?: () => Promise<{ ok: boolean; connected: boolean; displayName?: string; error?: string }>;
  stravaStatus?: StravaStatus;
  autoUploadStrava?: boolean;
  onStravaLogin?: () => Promise<StravaLoginResult>;
}

const FREE_RIDE_FIELD_KEYS: SessionFieldKey[] = [
  'power',
  'sessionTimer',
  'cadence',
  'speedDistance',
  'heartRate',
  'energy',
  'chart',
];

export const FreeRidePlayer: React.FC<FreeRidePlayerProps> = ({
  ftp,
  weightKg = 72,
  maxHr = 190,
  restingHr = 55,
  age = 35,
  soundEnabled,
  sessionFieldModes,
  onUpdateSessionFieldModes,
  powerSmoothingSec = 3,
  onUpdatePowerSmoothing,
  onToggleSound,
  onExit,
  telemetry,
  activeTransport,
  connectionStatus,
  deviceName,
  onOpenConnectionModal,
  sendTargetPowerToActiveTrainer,
  garminStatus,
  autoUploadGarmin = false,
  onGarminLogin,
  stravaStatus,
  autoUploadStrava,
  onStravaLogin,
}) => {
  const { t, lang } = useI18n();
  const defaultTargetWatts = Math.max(50, Math.round(ftp * 0.6));

  const [ergEnabled, setErgEnabled] = useState<boolean>(true);
  const [targetWatts, setTargetWatts] = useState<number>(defaultTargetWatts);
  const [resistancePct, setResistancePct] = useState<number>(15);

  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [, setStaleTick] = useState(0);
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [miniHudActive, setMiniHudActive] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [garminUploadState, setGarminUploadState] = useState<
    'idle' | 'uploading' | 'success' | 'error'
  >('idle');
  const [garminResult, setGarminResult] = useState<GarminUploadResult | undefined>(undefined);
  const autoUploadedGarminRef = useRef(false);

  const [localStravaStatus, setLocalStravaStatus] = useState<StravaStatus>({ connected: false });
  const [localAutoUploadStrava, setLocalAutoUploadStrava] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('rulo_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.autoUploadStrava === 'boolean') {
          return parsed.autoUploadStrava;
        }
      }
    } catch {
      // ignore
    }
    return false;
  });
  const [stravaUploadState, setStravaUploadState] = useState<
    'idle' | 'uploading' | 'success' | 'error'
  >('idle');
  const [stravaResult, setStravaResult] = useState<StravaUploadResult | undefined>(undefined);
  const autoUploadedStravaRef = useRef(false);

  const effectiveStravaStatus = stravaStatus ?? localStravaStatus;
  const effectiveAutoUploadStrava = autoUploadStrava ?? localAutoUploadStrava;

  useEffect(() => {
    let cancelled = false;
    const syncStravaState = async () => {
      try {
        const raw = localStorage.getItem('rulo_settings');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!cancelled && typeof parsed?.autoUploadStrava === 'boolean') {
            setLocalAutoUploadStrava(parsed.autoUploadStrava);
          }
        } else if (window.electronAPI?.loadData) {
          const data = await window.electronAPI.loadData();
          if (!cancelled && typeof data?.settings?.autoUploadStrava === 'boolean') {
            setLocalAutoUploadStrava(data.settings.autoUploadStrava);
          }
        }
      } catch {
        // ignore
      }

      if (window.electronAPI?.stravaGetStatus) {
        try {
          const status = await window.electronAPI.stravaGetStatus();
          if (!cancelled && status) {
            setLocalStravaStatus(status);
          }
        } catch (e) {
          console.warn('Error checking Strava status', e);
        }
      }
    };
    void syncStravaState();
    return () => {
      cancelled = true;
    };
  }, [isFinished]);

  // Field visibility and blur modes
  const [fieldModes, setFieldModes] = useState<Record<string, SessionFieldMode>>(
    sessionFieldModes || {}
  );

  useEffect(() => {
    if (sessionFieldModes) {
      setFieldModes(sessionFieldModes);
    }
  }, [sessionFieldModes]);

  const getFieldMode = (key: SessionFieldKey): SessionFieldMode => {
    return fieldModes[key] || 'visible';
  };

  const setFieldMode = (key: SessionFieldKey, mode: SessionFieldMode) => {
    const updated = { ...fieldModes, [key]: mode };
    setFieldModes(updated);
    onUpdateSessionFieldModes?.(updated);
  };

  const toggleFieldBlur = (key: SessionFieldKey) => {
    const current = getFieldMode(key);
    setFieldMode(key, current === 'blur' ? 'visible' : 'blur');
  };

  const hideField = (key: SessionFieldKey) => {
    setFieldMode(key, 'hidden');
  };

  const restoreAllFields = () => {
    const updated = { ...fieldModes };
    FREE_RIDE_FIELD_KEYS.forEach((k) => {
      updated[k] = 'visible';
    });
    setFieldModes(updated);
    onUpdateSessionFieldModes?.(updated);
  };

  const hiddenFieldsCount = FREE_RIDE_FIELD_KEYS.filter(
    (k) => getFieldMode(k) === 'hidden'
  ).length;

  const isNoClockActive = getFieldMode('sessionTimer') !== 'visible';

  const toggleNoClockMode = () => {
    const nextMode: SessionFieldMode = isNoClockActive ? 'visible' : 'blur';
    setFieldMode('sessionTimer', nextMode);
  };

  const renderCardActions = (key: SessionFieldKey, isSecMetric = false) => {
    const mode = getFieldMode(key);
    const isBlur = mode === 'blur';
    return (
      <div className={isSecMetric ? 'sec-metric-actions' : 'field-card-actions'}>
        <button
          type="button"
          className={`field-mode-btn ${isBlur ? 'is-active-blur' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFieldBlur(key);
          }}
          title={isBlur ? t('player.blurRemove') : t('player.blurValue')}
        >
          <ScanEye size={isSecMetric ? 13 : 15} />
        </button>
        <button
          type="button"
          className="field-mode-btn"
          onClick={(e) => {
            e.stopPropagation();
            hideField(key);
          }}
          title={t('player.hidePanel')}
        >
          <EyeOff size={isSecMetric ? 13 : 15} />
        </button>
      </div>
    );
  };

  // Refs for accurate 1-Hz recording loop without stale closures
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const elapsedSecRef = useRef(elapsedSec);
  elapsedSecRef.current = elapsedSec;

  const distanceMetersRef = useRef(0);

  const weightKgRef = useRef(weightKg);
  weightKgRef.current = weightKg;

  const ergEnabledRef = useRef(ergEnabled);
  ergEnabledRef.current = ergEnabled;

  const targetWattsRef = useRef(targetWatts);
  targetWattsRef.current = targetWatts;

  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;

  const lastHrPacketMsRef = useRef<number>(
    telemetry.heartRateBpm && telemetry.heartRateBpm > 0 ? telemetry.timestamp || Date.now() : 0
  );

  const lastRecordedSecRef = useRef<number>(-1);
  const lastWallTimeRef = useRef<number | null>(null);

  const lastSentErgWattsRef = useRef<number | null>(null);
  const lastSentResistanceRef = useRef<number | null>(null);

  // Power smoothing buffer (up to 10s)
  const powerBufferRef = useRef<{ t: number; w: number }[]>([]);

  // 1-second packet accumulator
  const secondAccumulatorRef = useRef<{
    sumW: number;
    sumCad: number;
    nCad: number;
    sumHr: number;
    nHr: number;
    n: number;
  }>({ sumW: 0, sumCad: 0, nCad: 0, sumHr: 0, nHr: 0, n: 0 });

  useEffect(() => {
    const now = telemetry.timestamp || Date.now();
    const w = telemetry.powerWatts || 0;
    const cad = telemetry.cadenceRpm || 0;

    if (w <= 0 && cad <= 0) {
      powerBufferRef.current = [];
    } else {
      const lastSample = powerBufferRef.current[powerBufferRef.current.length - 1];
      if (lastSample && now - lastSample.t > 3000) {
        powerBufferRef.current = [];
      }
      powerBufferRef.current.push({ t: now, w });
      const cutoff = now - 10000;
      powerBufferRef.current = powerBufferRef.current.filter((sample) => sample.t >= cutoff);
    }

    const hr = telemetry.heartRateBpm;
    if (typeof hr === 'number' && hr > 0) {
      lastHrPacketMsRef.current = now;
    } else {
      lastHrPacketMsRef.current = 0;
    }

    if (isPlayingRef.current) {
      const acc = secondAccumulatorRef.current;
      acc.sumW += w;
      acc.n += 1;

      if (typeof cad === 'number' && cad > 0) {
        acc.sumCad += cad;
        acc.nCad += 1;
      }

      if (typeof hr === 'number' && hr > 0) {
        acc.sumHr += hr;
        acc.nHr += 1;
      }
    }

    const timer3s = setTimeout(() => {
      setStaleTick(Date.now());
    }, 3050);
    const timer6s = setTimeout(() => {
      setStaleTick(Date.now());
    }, 6100);

    return () => {
      clearTimeout(timer3s);
      clearTimeout(timer6s);
    };
  }, [telemetry.timestamp, telemetry.powerWatts, telemetry.cadenceRpm, telemetry.heartRateBpm]);

  // Smoothed power for UI display with 3000ms stale fallback
  const smoothingSec = powerSmoothingSec ?? 3;
  const smoothingSecRef = useRef(smoothingSec);
  smoothingSecRef.current = smoothingSec;

  const computeSmoothedWatts = (nowMs: number, curTelem: TrainerTelemetry, smoothWindowSec: number): number => {
    if (!curTelem.timestamp || nowMs - curTelem.timestamp > 3000) {
      return 0;
    }
    const rawWatts = curTelem.powerWatts || 0;
    if (rawWatts <= 0 && (curTelem.cadenceRpm || 0) <= 0) {
      return 0;
    }
    if (smoothWindowSec === 0) {
      return Math.round(rawWatts);
    }
    const refTime = curTelem.timestamp || nowMs;
    const windowStart = refTime - smoothWindowSec * 1000;
    const samples = powerBufferRef.current.filter((s) => s.t >= windowStart);
    if (samples.length === 0) {
      return Math.round(rawWatts);
    }
    const sum = samples.reduce((acc, s) => acc + s.w, 0);
    return Math.round(sum / samples.length);
  };

  const nowRenderMs = Date.now();
  const isTelemetryStale = !telemetry.timestamp || nowRenderMs - telemetry.timestamp > 3000;
  const isHrStale =
    !telemetry.heartRateBpm ||
    telemetry.heartRateBpm <= 0 ||
    !lastHrPacketMsRef.current ||
    nowRenderMs - lastHrPacketMsRef.current > 6000;

  const displayWatts = computeSmoothedWatts(nowRenderMs, telemetry, smoothingSec);
  const displayCadence = isTelemetryStale ? 0 : telemetry.cadenceRpm || 0;
  const displayHeartRateBpm = isHrStale ? undefined : telemetry.heartRateBpm;
  const liveSpeedKmh =
    isPlaying && !isFinished && displayWatts > 0
      ? estimateVirtualSpeedKmh(displayWatts, weightKg)
      : 0;

  const handleCycleSmoothing = () => {
    const current = powerSmoothingSec ?? 3;
    const next: 0 | 3 | 5 = current === 0 ? 3 : current === 3 ? 5 : 0;
    onUpdatePowerSmoothing?.(next);
  };

  // Sync trainer resistance/power when mode, target, resistance, transport or playing status changes
  useEffect(() => {
    if (ergEnabled) {
      lastSentResistanceRef.current = null;
      const desiredWatts = isPlaying ? Math.max(30, Math.round(targetWatts)) : 100;
      if (lastSentErgWattsRef.current !== desiredWatts) {
        lastSentErgWattsRef.current = desiredWatts;
        sendTargetPowerToActiveTrainer(desiredWatts);
      }
    } else {
      lastSentErgWattsRef.current = null;
      if (activeTransport === 'ant' && window.electronAPI?.antSetBasicResistance) {
        const clampedPct = Math.max(0, Math.min(100, Math.round(resistancePct)));
        if (lastSentResistanceRef.current !== clampedPct) {
          lastSentResistanceRef.current = clampedPct;
          void window.electronAPI.antSetBasicResistance(clampedPct);
        }
      }
    }
  }, [ergEnabled, targetWatts, resistancePct, isPlaying, activeTransport, sendTargetPowerToActiveTrainer]);

  // Main 1-Hz Free Ride Recording Loop
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

      const curTelem = telemetryRef.current;
      const tickWatts = computeSmoothedWatts(now, curTelem, smoothingSecRef.current);
      const speedKmh =
        tickWatts > 0 ? estimateVirtualSpeedKmh(tickWatts, weightKgRef.current) : 0;

      if (deltaSec > 0) {
        distanceMetersRef.current += (speedKmh / 3.6) * deltaSec;
        setDistanceMeters(distanceMetersRef.current);
      }

      const nextElapsed = elapsedSecRef.current + deltaSec;
      const currentSec = Math.floor(nextElapsed);

      elapsedSecRef.current = nextElapsed;
      setElapsedSec(nextElapsed);

      if (currentSec !== lastRecordedSecRef.current) {
        lastRecordedSecRef.current = currentSec;
        const isStaleNow = !curTelem.timestamp || now - curTelem.timestamp > 3000;
        const isHrStaleNow =
          !curTelem.heartRateBpm ||
          curTelem.heartRateBpm <= 0 ||
          !lastHrPacketMsRef.current ||
          now - lastHrPacketMsRef.current > 6000;
        const acc = secondAccumulatorRef.current;

        const recPower =
          acc.n > 0
            ? Math.round(acc.sumW / acc.n)
            : isStaleNow
            ? 0
            : curTelem.powerWatts || 0;

        let recCadence: number;
        if (acc.nCad > 0) {
          recCadence = Math.round(acc.sumCad / acc.nCad);
        } else if (acc.n > 0 || isStaleNow) {
          recCadence = 0;
        } else {
          recCadence = curTelem.cadenceRpm || 0;
        }

        let recHr: number | undefined;
        if (acc.nHr > 0) {
          recHr = Math.round(acc.sumHr / acc.nHr);
        } else if (!isHrStaleNow && curTelem.heartRateBpm && curTelem.heartRateBpm > 0) {
          recHr = curTelem.heartRateBpm;
        } else {
          recHr = undefined;
        }

        const recSpeedKmh =
          recPower > 0 ? estimateVirtualSpeedKmh(recPower, weightKgRef.current) : 0;
        const recDistanceMeters = Number(distanceMetersRef.current.toFixed(2));

        secondAccumulatorRef.current = { sumW: 0, sumCad: 0, nCad: 0, sumHr: 0, nHr: 0, n: 0 };

        setRecordedSamples((prevSamples) => [
          ...prevSamples,
          {
            timestampMs: now,
            elapsedSec: currentSec,
            powerWatts: recPower,
            targetWatts: ergEnabledRef.current ? targetWattsRef.current : 0,
            cadenceRpm: recCadence,
            speedKmh: recSpeedKmh,
            distanceMeters: recDistanceMeters,
            heartRateBpm: recHr,
          },
        ]);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isPlaying, isFinished]);

  // Handlers for ERG target adjustments
  const updateTargetWatts = (next: number) => {
    setTargetWatts(Math.max(30, Math.min(2000, Math.round(next))));
  };

  const handleTogglePlay = () => {
    if (isFinished) {
      setElapsedSec(0);
      elapsedSecRef.current = 0;
      distanceMetersRef.current = 0;
      setDistanceMeters(0);
      setIsFinished(false);
      setRecordedSamples([]);
      setExportMessage(null);
      setGarminUploadState('idle');
      setGarminResult(undefined);
      autoUploadedGarminRef.current = false;
      setStravaUploadState('idle');
      setStravaResult(undefined);
      autoUploadedStravaRef.current = false;
      lastRecordedSecRef.current = -1;
      secondAccumulatorRef.current = { sumW: 0, sumCad: 0, nCad: 0, sumHr: 0, nHr: 0, n: 0 };
      setIsPlaying(true);
      return;
    }
    if (!isPlaying && elapsedSecRef.current === 0) {
      distanceMetersRef.current = 0;
      setDistanceMeters(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleEndSession = () => {
    if (confirm(t('freeride.confirmEnd'))) {
      setIsPlaying(false);
      setIsFinished(true);
      if (soundEnabled) playWorkoutCompleteFanfare();
    }
  };

  const sessionTitle = ergEnabled
    ? t('freeride.sessionTitleErg')
    : t('freeride.sessionTitleFree');

  // Export handlers
  const handleExportTcx = async () => {
    try {
      const tcxContent = generateTcx(sessionTitle, recordedSamples);
      const defaultFileName = `${t('freeride.filePrefix')}_${new Date().toISOString().slice(0, 10)}.tcx`;

      if (window.electronAPI?.exportActivityFile) {
        const res = await window.electronAPI.exportActivityFile({
          defaultFileName,
          tcxContent,
        });
        if (!res.canceled && !res.error) {
          setExportMessage(t('player.tcxSaved', { path: res.filePath || defaultFileName }));
        } else if (res.error) {
          alert(t('player.tcxSaveError', { error: res.error }));
        }
        return;
      }

      const blob = new Blob([tcxContent], { type: 'application/vnd.garmin.tcx+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFileName;
      a.click();
      URL.revokeObjectURL(url);
      setExportMessage(t('player.tcxDownloadStarted'));
    } catch (err) {
      alert(t('player.tcxGenError', { error: (err as Error).message }));
    }
  };

  const handleExportFit = async () => {
    try {
      const fitBase64 = generateFitBase64(sessionTitle, recordedSamples);
      const defaultFileName = `${t('freeride.filePrefix')}_${new Date().toISOString().slice(0, 10)}.fit`;

      if (window.electronAPI?.exportActivityFile) {
        const res = await window.electronAPI.exportActivityFile({
          defaultFileName,
          tcxContent: '',
          fitBase64,
        });
        if (!res.canceled && !res.error) {
          setExportMessage(t('player.fitSaved', { path: res.filePath || defaultFileName }));
        } else if (res.error) {
          alert(t('player.fitSaveError', { error: res.error }));
        }
        return;
      }

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
      setExportMessage(t('player.fitDownloadStarted'));
    } catch (err) {
      alert(t('player.fitGenError', { error: (err as Error).message }));
    }
  };

  const handleUploadToGarmin = async (forceRelogin = false) => {
    setGarminUploadState('uploading');
    setGarminResult(undefined);

    try {
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `${t('freeride.filePrefix')}_${date}.fit`;
      const fitBase64 = generateFitBase64(sessionTitle, recordedSamples);
      const tcxContent = generateTcx(sessionTitle, recordedSamples);

      if (!garminStatus?.connected || forceRelogin) {
        if (!onGarminLogin) {
          setGarminUploadState('error');
          setGarminResult({
            ok: false,
            error: t('player.garminNoLoginManager'),
          });
          return;
        }
        const loginRes = await onGarminLogin();
        if (!loginRes.ok || !loginRes.connected) {
          setGarminUploadState('error');
          setGarminResult({
            ok: false,
            error: loginRes.error || t('player.garminLoginFailed'),
          });
          return;
        }
      }

      if (!window.electronAPI?.garminUploadActivity) {
        setGarminUploadState('error');
        setGarminResult({
          ok: false,
          error: t('player.garminDesktopOnly'),
        });
        return;
      }

      const res = await window.electronAPI.garminUploadActivity({
        fileName,
        fitBase64,
        tcxContent,
        workoutName: sessionTitle,
      });

      if (res.ok) {
        setGarminUploadState('success');
        setGarminResult(res);
      } else {
        setGarminUploadState('error');
        setGarminResult(res);
      }
    } catch (err) {
      setGarminUploadState('error');
      setGarminResult({
        ok: false,
        error: (err as Error).message || t('player.garminUnexpectedError'),
      });
    }
  };

  useEffect(() => {
    if (
      isFinished &&
      recordedSamples.length > 5 &&
      autoUploadGarmin &&
      garminStatus?.connected &&
      !autoUploadedGarminRef.current
    ) {
      autoUploadedGarminRef.current = true;
      void handleUploadToGarmin();
    }
  }, [isFinished, recordedSamples.length, autoUploadGarmin, garminStatus?.connected]);

  const handleUploadToStrava = async (forceRelogin = false) => {
    setStravaUploadState('uploading');
    setStravaResult(undefined);

    try {
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `${t('freeride.filePrefix')}_${date}.fit`;
      const fitBase64 = generateFitBase64(sessionTitle, recordedSamples);
      const tcxContent = generateTcx(sessionTitle, recordedSamples);

      let currentStatus = effectiveStravaStatus;
      if (!currentStatus?.connected && window.electronAPI?.stravaGetStatus) {
        try {
          const fresh = await window.electronAPI.stravaGetStatus();
          if (fresh) {
            setLocalStravaStatus(fresh);
            currentStatus = fresh;
          }
        } catch {
          // ignore
        }
      }

      if (!currentStatus?.connected || forceRelogin) {
        const loginFn =
          onStravaLogin ??
          (window.electronAPI?.stravaLogin
            ? () => window.electronAPI!.stravaLogin()
            : undefined);

        if (!loginFn) {
          setStravaUploadState('error');
          setStravaResult({
            ok: false,
            error: t('player.stravaNoLoginManager'),
          });
          return;
        }
        const loginRes = await loginFn();
        if (loginRes) {
          setLocalStravaStatus({
            connected: Boolean(loginRes.connected),
            displayName: loginRes.displayName,
            lastVerifiedAt: loginRes.connected ? new Date().toISOString() : undefined,
          });
        }
        if (!loginRes.ok || !loginRes.connected) {
          setStravaUploadState('error');
          setStravaResult({
            ok: false,
            error: loginRes.error || t('player.stravaLoginFailed'),
          });
          return;
        }
      }

      if (!window.electronAPI?.stravaUploadActivity) {
        setStravaUploadState('error');
        setStravaResult({
          ok: false,
          error: t('player.stravaDesktopOnly'),
        });
        return;
      }

      const res = await window.electronAPI.stravaUploadActivity({
        fileName,
        fitBase64,
        tcxContent,
        workoutName: sessionTitle,
      });

      if (res.ok) {
        setStravaUploadState('success');
        setStravaResult(res);
      } else {
        setStravaUploadState('error');
        setStravaResult(res);
      }
    } catch (err) {
      setStravaUploadState('error');
      setStravaResult({
        ok: false,
        error: (err as Error).message || t('player.stravaUnexpectedError'),
      });
    }
  };

  useEffect(() => {
    if (
      isFinished &&
      recordedSamples.length > 0 &&
      effectiveAutoUploadStrava &&
      effectiveStravaStatus?.connected &&
      !autoUploadedStravaRef.current
    ) {
      autoUploadedStravaRef.current = true;
      void handleUploadToStrava();
    }
  }, [
    isFinished,
    recordedSamples.length,
    effectiveAutoUploadStrava,
    effectiveStravaStatus?.connected,
  ]);

  // Derived zone & live telemetry values
  const zoneThresholds = useMemo(() => getPowerZoneThresholds(ftp, lang), [ftp, lang]);
  const zoneInfo = getPowerZone(displayWatts, ftp, lang);
  const targetZoneInfo = getPowerZone(targetWatts, ftp, lang);
  const powerDelta = displayWatts - targetWatts;

  const toggleMiniHud = async () => {
    if (!window.electronAPI?.openMiniHud) return;
    if (miniHudActive) {
      setMiniHudActive(false);
      await window.electronAPI.closeMiniHud?.();
    } else {
      const ok = await window.electronAPI.openMiniHud();
      if (ok) {
        setMiniHudActive(true);
      }
    }
  };

  useEffect(() => {
    if (!miniHudActive || !window.electronAPI?.updateMiniHud) return;
    const activeZone = ergEnabled ? targetZoneInfo : zoneInfo;
    window.electronAPI.updateMiniHud({
      mode: 'freeride',
      lang,
      isPlaying,
      isFinished,
      powerWatts: displayWatts,
      targetWatts: ergEnabled ? targetWatts : null,
      ergEnabled,
      zoneCode: activeZone.code,
      zoneColor: activeZone.color,
      zoneName: activeZone.name,
      heartRateBpm: telemetry.heartRateBpm,
      cadenceRpm: telemetry.cadenceRpm,
      elapsedSec,
      hideClock: isNoClockActive,
      resistancePct,
    });
  }, [
    miniHudActive,
    lang,
    isPlaying,
    isFinished,
    displayWatts,
    targetWatts,
    ergEnabled,
    targetZoneInfo,
    zoneInfo,
    telemetry.heartRateBpm,
    telemetry.cadenceRpm,
    elapsedSec,
    isNoClockActive,
    resistancePct,
  ]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMiniHudCommand) return;

    const unsubCmd = api.onMiniHudCommand((cmd) => {
      if (cmd.type === 'wattsDelta') {
        if (ergEnabledRef.current) {
          setTargetWatts((prev) => Math.max(30, Math.min(2000, Math.round(prev + cmd.delta))));
        } else {
          const step = cmd.delta > 0 ? 5 : -5;
          setResistancePct((prev) => Math.max(0, Math.min(100, prev + step)));
        }
      } else if (cmd.type === 'togglePause') {
        setIsPlaying((prev) => !prev);
      } else if (cmd.type === 'close') {
        setMiniHudActive(false);
        void api.closeMiniHud?.();
      }
    });

    const unsubClosed = api.onMiniHudClosed?.(() => {
      setMiniHudActive(false);
    });

    return () => {
      unsubCmd();
      unsubClosed?.();
    };
  }, []);

  useEffect(() => {
    if (isFinished && miniHudActive) {
      setMiniHudActive(false);
      void window.electronAPI?.closeMiniHud?.();
    }
  }, [isFinished, miniHudActive]);

  useEffect(() => {
    return () => {
      void window.electronAPI?.closeMiniHud?.();
    };
  }, []);

  const liveEnergy = useMemo(() => {
    return computeRecordedKcal(recordedSamples, {
      weightKg,
      maxHr,
      restingHr,
      age,
    });
  }, [recordedSamples, weightKg, maxHr, restingHr, age]);

  const liveAvgWatts = useMemo(() => {
    if (recordedSamples.length === 0) return 0;
    return Math.round(
      recordedSamples.reduce((acc, s) => acc + s.powerWatts, 0) / recordedSamples.length
    );
  }, [recordedSamples]);

  const hrZoneInfo: HrZoneInfo | null = useMemo(() => {
    if (displayHeartRateBpm && displayHeartRateBpm > 0) {
      return getHrZone(displayHeartRateBpm, maxHr, restingHr, lang);
    }
    return null;
  }, [displayHeartRateBpm, maxHr, restingHr, lang]);

  // Post-ride summary calculations
  const summaryStats = useMemo(() => {
    if (recordedSamples.length === 0) return null;
    const avgW = Math.round(
      recordedSamples.reduce((acc, s) => acc + s.powerWatts, 0) / recordedSamples.length
    );
    const avgWkg = weightKg > 0 ? (avgW / weightKg).toFixed(2) : '0.00';
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
    const maxHrSample =
      hrSamples.length > 0
        ? Math.max(...hrSamples.map((s) => s.heartRateBpm || 0))
        : null;

    const energy = computeRecordedKcal(recordedSamples, {
      weightKg,
      maxHr,
      restingHr,
      age,
    });

    return {
      avgW,
      avgWkg,
      maxW,
      avgCad,
      totalDistKm,
      avgHr,
      maxHr: maxHrSample,
      kcal: energy.kcal,
      workKj: energy.workKj,
    };
  }, [recordedSamples, weightKg, maxHr, restingHr, age]);

  // Live SVG Power Chart geometry
  const chartModel = useMemo(() => {
    const svgW = 920;
    const svgH = 180;
    const padL = 44;
    const padR = 14;
    const padT = 16;
    const padB = 22;
    const innerW = svgW - padL - padR;
    const innerH = svgH - padT - padB;

    const maxSampleW =
      recordedSamples.length > 0
        ? Math.max(...recordedSamples.map((s) => Math.max(s.powerWatts, s.targetWatts || 0)))
        : 0;
    const rawMax = Math.max(
      ftp * 1.35,
      ergEnabled ? targetWatts * 1.15 : 0,
      maxSampleW * 1.1,
      200
    );
    const maxScaleWatts = Math.ceil(rawMax / 50) * 50;

    const yForWatts = (w: number) => {
      const clamped = Math.max(0, Math.min(maxScaleWatts, w));
      return padT + innerH - (clamped / maxScaleWatts) * innerH;
    };

    const ftpY = yForWatts(ftp);
    const targetY = yForWatts(targetWatts);

    let powerPoints = '';
    let areaPoints = '';
    if (recordedSamples.length > 0) {
      const denom = Math.max(1, recordedSamples.length - 1);
      const pts = recordedSamples.map((s, idx) => {
        const x =
          recordedSamples.length === 1
            ? padL + innerW
            : padL + (idx / denom) * innerW;
        const y = yForWatts(s.powerWatts);
        return { x, y };
      });
      powerPoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const firstX = pts[0].x.toFixed(1);
      const lastX = pts[pts.length - 1].x.toFixed(1);
      const baseY = (padT + innerH).toFixed(1);
      areaPoints = `${firstX},${baseY} ${powerPoints} ${lastX},${baseY}`;
    }

    const gridWatts = [0, Math.round(maxScaleWatts / 2), maxScaleWatts];

    return {
      svgW,
      svgH,
      padL,
      padR,
      padT,
      padB,
      innerW,
      innerH,
      maxScaleWatts,
      ftpY,
      targetY,
      powerPoints,
      areaPoints,
      gridWatts,
      yForWatts,
    };
  }, [recordedSamples, ftp, ergEnabled, targetWatts]);

  // Field visibility checks
  const tilePowerVisible = getFieldMode('power') !== 'hidden';
  const tileTimerVisible = getFieldMode('sessionTimer') !== 'hidden';
  const visibleCockpitCount = (tilePowerVisible ? 1 : 0) + (tileTimerVisible ? 1 : 0);

  const cadenceVisible = getFieldMode('cadence') !== 'hidden';
  const speedDistanceVisible = getFieldMode('speedDistance') !== 'hidden';
  const heartRateVisible = getFieldMode('heartRate') !== 'hidden';
  const energyVisible = getFieldMode('energy') !== 'hidden';
  const hasAnySecMetric =
    cadenceVisible || speedDistanceVisible || heartRateVisible || energyVisible;
  const chartVisible = getFieldMode('chart') !== 'hidden';

  return (
    <div className="player-container">
      {/* Top Status Bar */}
      <div className="player-top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#f8fafc' }}>
            {t('freeride.title')}
          </div>
          <span
            className="brand-badge"
            style={
              ergEnabled
                ? undefined
                : {
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: 'var(--accent-emerald)',
                    borderColor: 'rgba(16, 185, 129, 0.35)',
                  }
            }
          >
            {ergEnabled ? t('player.ergActive') : t('freeride.badgeFree')}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Trainer Connection Pill */}
          <div
            className="connection-pill"
            onClick={onOpenConnectionModal}
            title={t('freeride.trainerPillTitle')}
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
                : t('player.trainerDisconnected')}
            </span>
          </div>

          {/* Sin Reloj 1-click button */}
          <button
            type="button"
            className={`btn ${isNoClockActive ? 'btn-secondary btn-accent-active' : 'btn-secondary'}`}
            onClick={toggleNoClockMode}
            title={
              isNoClockActive
                ? t('freeride.noClockActiveTitle')
                : t('freeride.noClockInactiveTitle')
            }
          >
            {isNoClockActive ? (
              <TimerOff size={16} style={{ color: 'var(--accent-cyan)' }} />
            ) : (
              <Timer size={16} />
            )}
            <span>{t('player.noClock')}</span>
          </button>

          {/* Mini-HUD Floating Always-on-Top button */}
          <button
            type="button"
            className={`btn ${miniHudActive ? 'btn-secondary btn-accent-active' : 'btn-secondary'}`}
            onClick={toggleMiniHud}
            title={
              !window.electronAPI?.openMiniHud
                ? t('minihud.desktopOnlyTitle')
                : miniHudActive
                ? t('minihud.btnCloseTitle')
                : t('minihud.btnOpenTitle')
            }
          >
            <PictureInPicture2
              size={16}
              style={miniHudActive ? { color: 'var(--accent-cyan)' } : undefined}
            />
            <span>{t('minihud.btn')}</span>
            <span className="mini-hud-pro-badge">{t('minihud.proBadge')}</span>
          </button>

          {/* Power Smoothing Pill */}
          <button
            type="button"
            className="power-smoothing-pill"
            style={{ padding: '7px 11px', fontSize: '0.8rem' }}
            onClick={handleCycleSmoothing}
            title={t('player.smoothingTitle')}
          >
            {t('player.smoothing', {
              val: smoothingSec === 0 ? t('player.smoothingInst') : `${smoothingSec}s`,
            })}
          </button>

          {/* Restore hidden cards button when any card is hidden */}
          {hiddenFieldsCount > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '7px 11px', fontSize: '0.8rem', color: 'var(--accent-amber)' }}
              onClick={restoreAllFields}
              title={t('freeride.showHiddenTitle')}
            >
              <Eye size={15} /> {t('freeride.showHidden', { count: hiddenFieldsCount })}
            </button>
          )}

          {/* Sound Toggle */}
          <button
            className="btn btn-secondary btn-icon"
            onClick={onToggleSound}
            title={soundEnabled ? t('player.soundOn') : t('player.soundOff')}
          >
            {soundEnabled ? (
              <Volume2 size={18} style={{ color: 'var(--accent-cyan)' }} />
            ) : (
              <VolumeX size={18} style={{ color: 'var(--text-dim)' }} />
            )}
          </button>

          {/* Exit */}
          <button
            className="btn btn-secondary"
            onClick={() => {
              if (isPlaying) {
                if (confirm(t('freeride.confirmExitPlaying'))) {
                  setIsPlaying(false);
                  onExit();
                }
              } else {
                onExit();
              }
            }}
          >
            <X size={16} /> {t('player.exit')}
          </button>
        </div>
      </div>

      {/* Mode Switcher & ERG / Free Resistance Control Panel */}
      <div className="freeride-control-panel">
        <div className="freeride-mode-header">
          {/* Prominent ERG <-> Free Toggle */}
          <div className="freeride-mode-switch" role="group" aria-label={t('freeride.resistanceModeAria')}>
            <button
              type="button"
              className={`freeride-mode-btn ${ergEnabled ? 'is-active-erg' : ''}`}
              onClick={() => setErgEnabled(true)}
            >
              <Zap size={16} />
              <span>{t('freeride.withErg')}</span>
            </button>
            <button
              type="button"
              className={`freeride-mode-btn ${!ergEnabled ? 'is-active-free' : ''}`}
              onClick={() => setErgEnabled(false)}
            >
              <Wind size={16} />
              <span>{t('freeride.withoutErg')}</span>
            </button>
          </div>

          {ergEnabled ? (
            <div className="freeride-erg-controls">
              {/* Target Watts Input + Step Buttons */}
              <div className="freeride-target-group">
                <span className="freeride-target-label">{t('freeride.ergTarget')}</span>
                <div className="freeride-target-input-wrap">
                  <NumericInput
                    className="freeride-watts-input"
                    value={targetWatts}
                    min={30}
                    max={2000}
                    fallback={defaultTargetWatts}
                    onChange={updateTargetWatts}
                    title={t('freeride.targetWattsTitle')}
                  />
                  <span style={{ fontWeight: 700, color: 'var(--accent-cyan)' }}>W</span>
                </div>
                <span
                  className="freeride-target-meta"
                  style={{
                    color: targetZoneInfo.color,
                    borderColor: `${targetZoneInfo.color}55`,
                    background: `${targetZoneInfo.color}18`,
                  }}
                >
                  {targetZoneInfo.code} · {Math.round((targetWatts / Math.max(1, ftp)) * 100)}% FTP
                </span>
              </div>

              {/* -10 / -5 / +5 / +10 buttons */}
              <div className="freeride-step-buttons">
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '7px 11px', fontSize: '0.82rem' }}
                  onClick={() => updateTargetWatts(targetWatts - 10)}
                  title={t('player.reduce10W')}
                >
                  -10 W
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '7px 11px', fontSize: '0.82rem' }}
                  onClick={() => updateTargetWatts(targetWatts - 5)}
                  title={t('player.reduce5W')}
                >
                  -5 W
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '7px 11px', fontSize: '0.82rem' }}
                  onClick={() => updateTargetWatts(targetWatts + 5)}
                  title={t('player.add5W')}
                >
                  +5 W
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '7px 11px', fontSize: '0.82rem' }}
                  onClick={() => updateTargetWatts(targetWatts + 10)}
                  title={t('player.add10W')}
                >
                  +10 W
                </button>
              </div>

              {/* Quick Zone Step Buttons */}
              <div className="freeride-zone-step-group">
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '7px 12px', fontSize: '0.82rem' }}
                  onClick={() => updateTargetWatts(getPrevZoneMinWatts(targetWatts, ftp))}
                  title={t('freeride.prevZoneTitle')}
                >
                  <ChevronLeft size={15} /> {t('freeride.prevZone')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '7px 12px', fontSize: '0.82rem' }}
                  onClick={() => updateTargetWatts(getNextZoneMinWatts(targetWatts, ftp))}
                  title={t('freeride.nextZoneTitle')}
                >
                  {t('freeride.nextZone')} <ChevronRight size={15} />
                </button>
              </div>
            </div>
          ) : (
            /* Sin ERG (Libre) Control */
            <div className="freeride-free-controls">
              <div className="freeride-resistance-row">
                <span className="freeride-target-label">
                  {t('freeride.baseResistance')}{' '}
                  <strong style={{ color: 'var(--accent-emerald)', fontSize: '1rem' }}>{resistancePct}%</strong>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={resistancePct}
                  onChange={(e) => setResistancePct(Number(e.target.value))}
                  className="freeride-slider"
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  {[0, 15, 30, 50, 75].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className={`btn ${resistancePct === pct ? 'btn-emerald' : 'btn-secondary'}`}
                      style={{ padding: '5px 10px', fontSize: '0.78rem' }}
                      onClick={() => setResistancePct(pct)}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              {activeTransport !== 'ant' && (
                <div className="freeride-free-note">
                  {activeTransport === 'ble'
                    ? t('freeride.freeNoteBle')
                    : activeTransport === 'simulator'
                    ? t('freeride.freeNoteSim')
                    : t('freeride.freeNoteDefault')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 1-Tap Zone Pills Z1..Z6 when ERG is enabled */}
        {ergEnabled && (
          <div className="freeride-zone-pills-row">
            {zoneThresholds.map((z) => {
              const isCurrentTargetZone = targetZoneInfo.zone === z.zone;
              return (
                <button
                  key={z.code}
                  type="button"
                  className={`freeride-zone-pill ${isCurrentTargetZone ? 'is-active' : ''}`}
                  style={{
                    borderColor: isCurrentTargetZone ? z.color : `${z.color}45`,
                    background: isCurrentTargetZone ? `${z.color}28` : 'rgba(15, 23, 42, 0.75)',
                    color: isCurrentTargetZone ? '#ffffff' : '#cbd5e1',
                  }}
                  onClick={() => updateTargetWatts(z.jumpWatts)}
                  title={t('freeride.zonePillTitle', {
                    code: z.code,
                    name: z.name,
                    jumpWatts: z.jumpWatts,
                    minWatts: z.minWatts,
                    minPct: z.minPct,
                  })}
                >
                  <span
                    className="freeride-zone-dot"
                    style={{ background: z.color }}
                  />
                  <strong>{z.code}</strong>
                  <span>·</span>
                  <span className="tabular">{z.jumpWatts}W</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Cockpit Hero Grid (Potencia Actual + Tiempo de Rodaje) */}
      {visibleCockpitCount > 0 && (
        <div
          className="player-cockpit-grid"
          style={{
            gridTemplateColumns:
              visibleCockpitCount === 2 ? '1.35fr 1fr' : '1fr',
            paddingTop: 14,
          }}
        >
          {/* TILE 1: POTENCIA ACTUAL */}
          {tilePowerVisible && (
            <div className="cockpit-tile cockpit-tile-power">
              <div
                className="metric-card-header"
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {t('player.currentPower')}
                  </span>
                  {getFieldMode('power') !== 'blur' && (
                    <span
                      className="zone-badge"
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: `${zoneInfo.color}25`,
                        color: zoneInfo.color,
                        border: `1px solid ${zoneInfo.color}60`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {zoneInfo.code} · { getPowerZoneLabel(zoneInfo.zone, lang) }
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                  {ergEnabled && getFieldMode('power') !== 'blur' && (
                    <div
                      style={{
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        color:
                          Math.abs(powerDelta) <= 5
                            ? '#10b981'
                            : powerDelta > 0
                            ? '#38bdf8'
                            : '#f59e0b',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t('player.vsTarget', { delta: powerDelta >= 0 ? `+${powerDelta}` : powerDelta })}
                    </div>
                  )}
                  {renderCardActions('power')}
                </div>
              </div>

              <div className={`session-field-content ${getFieldMode('power') === 'blur' ? 'is-blurred' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '4px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline' }}>
                    <div className="power-hero-num">{displayWatts}</div>
                    <span className="power-unit-label">W</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
                      {weightKg > 0 ? (displayWatts / weightKg).toFixed(2) : '0.00'}{' '}
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>W/kg</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>
                      {t('freeride.sessionAvg')} <strong style={{ color: '#e2e8f0' }}>{liveAvgWatts} W</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TILE 2: TIEMPO DE RODAJE */}
          {tileTimerVisible && (
            <div className="cockpit-tile">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  {t('freeride.rideTime')}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {getFieldMode('sessionTimer') !== 'blur' && (
                    <span
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: isPlaying ? 'var(--accent-emerald)' : 'var(--text-muted)',
                      }}
                    >
                      {isPlaying
                        ? t('freeride.statusRunning')
                        : elapsedSec > 0
                        ? t('freeride.statusPaused')
                        : t('freeride.statusReady')}
                    </span>
                  )}
                  {renderCardActions('sessionTimer')}
                </div>
              </div>

              <div className={`session-field-content ${getFieldMode('sessionTimer') === 'blur' ? 'is-blurred' : ''}`}>
                <div className="countdown-hero" style={{ margin: '12px 0' }}>
                  {formatTime(Math.floor(elapsedSec))}
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
                    fontSize: '0.82rem',
                    color: 'var(--text-dim)',
                  }}
                >
                  <span>
                    {t('freeride.modeLabel')}{' '}
                    <strong style={{ color: ergEnabled ? 'var(--accent-cyan)' : 'var(--accent-emerald)' }}>
                      {ergEnabled
                        ? `ERG ${targetWatts} W`
                        : `${t('freeride.modeFree')} ${activeTransport === 'ant' ? `(${resistancePct}%)` : ''}`}
                    </strong>
                  </span>
                  <span>
                    {t('freeride.ftpRef')} <strong style={{ color: '#fff' }}>{ftp} W</strong>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Secondary Metrics Strip */}
      {hasAnySecMetric && (
        <div className="secondary-metrics-strip">
          {cadenceVisible && (
            <div className="sec-metric-card" style={{ position: 'relative' }}>
              {renderCardActions('cadence', true)}
              <div
                className={`session-field-content ${getFieldMode('cadence') === 'blur' ? 'is-blurred' : ''}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
              >
                <div>
                  <div className="sec-metric-unit">{t('player.cadence')}</div>
                  <div className="sec-metric-val">
                    {displayCadence}
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: 4 }}>RPM</span>
                  </div>
                </div>
                <Gauge size={26} style={{ color: 'var(--accent-purple)' }} />
              </div>
            </div>
          )}

          {speedDistanceVisible && (
            <>
              <div className="sec-metric-card" style={{ position: 'relative' }}>
                {renderCardActions('speedDistance', true)}
                <div
                  className={`session-field-content ${getFieldMode('speedDistance') === 'blur' ? 'is-blurred' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
                >
                  <div>
                    <div className="sec-metric-unit">{t('player.speed')}</div>
                    <div className="sec-metric-val">
                      {liveSpeedKmh.toFixed(1)}
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: 4 }}>km/h</span>
                    </div>
                  </div>
                  <Compass size={26} style={{ color: 'var(--accent-cyan)' }} />
                </div>
              </div>

              <div className="sec-metric-card" style={{ position: 'relative' }}>
                {renderCardActions('speedDistance', true)}
                <div
                  className={`session-field-content ${getFieldMode('speedDistance') === 'blur' ? 'is-blurred' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
                >
                  <div>
                    <div className="sec-metric-unit">{t('player.distance')}</div>
                    <div className="sec-metric-val">
                      {(distanceMeters / 1000).toFixed(2)}
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: 4 }}>km</span>
                    </div>
                  </div>
                  <TrendingUp size={26} style={{ color: 'var(--accent-emerald)' }} />
                </div>
              </div>
            </>
          )}

          {heartRateVisible && (
            <div className="sec-metric-card" style={{ position: 'relative' }}>
              {renderCardActions('heartRate', true)}
              <div
                className={`session-field-content ${getFieldMode('heartRate') === 'blur' ? 'is-blurred' : ''}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
              >
                <div style={{ flex: 1, minWidth: 0, paddingRight: 48 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 2 }}>
                    <div className="sec-metric-unit">{t('player.heartRate')}</div>
                    {hrZoneInfo && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: `${hrZoneInfo.color}25`,
                          color: hrZoneInfo.color,
                          border: `1px solid ${hrZoneInfo.color}60`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {hrZoneInfo.code} · {hrZoneInfo.name}
                      </span>
                    )}
                  </div>
                  <div className="sec-metric-val">
                    {displayHeartRateBpm && displayHeartRateBpm > 0 ? (
                      displayHeartRateBpm
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>--</span>
                    )}
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: 4 }}>{t('player.bpmUnit')}</span>
                  </div>
                </div>
                <Heart
                  size={26}
                  style={{
                    color: displayHeartRateBpm ? 'var(--accent-rose)' : 'var(--text-dim)',
                    flexShrink: 0,
                    marginLeft: 8,
                  }}
                />
              </div>
            </div>
          )}

          {energyVisible && (
            <div className="sec-metric-card" style={{ position: 'relative' }}>
              {renderCardActions('energy', true)}
              <div
                className={`session-field-content ${getFieldMode('energy') === 'blur' ? 'is-blurred' : ''}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
              >
                <div>
                  <div className="sec-metric-unit">{t('player.energyBurned')}</div>
                  <div className="sec-metric-val" style={{ color: '#fb923c' }}>
                    {liveEnergy.kcal}
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 4 }}>kcal</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 2 }}>
                    {t('player.mechanicalKj', { kj: liveEnergy.workKj })}
                  </div>
                </div>
                <Flame size={26} style={{ color: 'var(--accent-amber)' }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live Power SVG Chart */}
      {chartVisible && (
        <div style={{ padding: '0 24px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div
            className="card"
            style={{
              position: 'relative',
              flex: 1,
              padding: '14px 18px',
              background: '#090d16',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minHeight: '210px',
            }}
          >
            <div style={{ position: 'absolute', top: 10, right: 14, zIndex: 10 }}>
              {renderCardActions('chart')}
            </div>

            <div
              className={`session-field-content ${getFieldMode('chart') === 'blur' ? 'is-blurred' : ''}`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{t('freeride.chartTitle')}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 12, height: 2, background: '#10b981', display: 'inline-block' }} />
                  {t('freeride.chartLegendPower')}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 12, borderTop: '2px dashed #f59e0b', display: 'inline-block' }} />
                  FTP ({ftp}W)
                </span>
                {ergEnabled && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 12, borderTop: '2px dashed #38bdf8', display: 'inline-block' }} />
                    {t('freeride.chartLegendTarget', { watts: targetWatts })}
                  </span>
                )}
              </div>

              <svg
                viewBox={`0 0 ${chartModel.svgW} ${chartModel.svgH}`}
                style={{ width: '100%', height: '180px', display: 'block', overflow: 'visible' }}
              >
                <defs>
                  <linearGradient id="freeRidePowerFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines */}
                {chartModel.gridWatts.map((gw) => {
                  const y = chartModel.yForWatts(gw);
                  return (
                    <g key={gw}>
                      <line
                        x1={chartModel.padL}
                        y1={y}
                        x2={chartModel.svgW - chartModel.padR}
                        y2={y}
                        stroke="#1e293b"
                        strokeWidth="1"
                      />
                      <text
                        x={chartModel.padL - 8}
                        y={y + 4}
                        textAnchor="end"
                        fill="#64748b"
                        fontSize="10"
                        fontWeight="600"
                      >
                        {gw}W
                      </text>
                    </g>
                  );
                })}

                {/* Dashed FTP Reference Line */}
                <line
                  x1={chartModel.padL}
                  y1={chartModel.ftpY}
                  x2={chartModel.svgW - chartModel.padR}
                  y2={chartModel.ftpY}
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  strokeDasharray="6 4"
                  opacity="0.85"
                />
                <text
                  x={chartModel.svgW - chartModel.padR - 4}
                  y={chartModel.ftpY - 5}
                  textAnchor="end"
                  fill="#fbbf24"
                  fontSize="10"
                  fontWeight="700"
                >
                  FTP {ftp}W
                </text>

                {/* Dashed Cyan ERG Target Line */}
                {ergEnabled && (
                  <>
                    <line
                      x1={chartModel.padL}
                      y1={chartModel.targetY}
                      x2={chartModel.svgW - chartModel.padR}
                      y2={chartModel.targetY}
                      stroke="#38bdf8"
                      strokeWidth="1.75"
                      strokeDasharray="6 4"
                    />
                    <text
                      x={chartModel.padL + 6}
                      y={chartModel.targetY - 5}
                      textAnchor="start"
                      fill="#38bdf8"
                      fontSize="10"
                      fontWeight="700"
                    >
                      {t('freeride.chartTargetShort', { watts: targetWatts })}
                    </text>
                  </>
                )}

                {/* Recorded Power Area & Polyline */}
                {recordedSamples.length > 1 && (
                  <polygon points={chartModel.areaPoints} fill="url(#freeRidePowerFill)" />
                )}
                {recordedSamples.length > 0 && (
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={chartModel.powerPoints}
                  />
                )}

                {/* Empty State Prompt */}
                {recordedSamples.length === 0 && (
                  <text
                    x={chartModel.padL + chartModel.innerW / 2}
                    y={chartModel.padT + chartModel.innerH / 2 + 4}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="13"
                    fontWeight="600"
                  >
                    {t('freeride.chartEmptyPrompt')}
                  </text>
                )}

                {/* Bottom X-axis labels */}
                <text
                  x={chartModel.padL}
                  y={chartModel.svgH - 4}
                  textAnchor="start"
                  fill="#64748b"
                  fontSize="10"
                >
                  00:00
                </text>
                <text
                  x={chartModel.svgW - chartModel.padR}
                  y={chartModel.svgH - 4}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="10"
                  fontWeight="600"
                >
                  {formatTime(Math.floor(elapsedSec))}
                </text>
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Player Controls Bar */}
      <div className="player-controls-bar">
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          {ergEnabled
            ? t('freeride.controlsErgStatus', { watts: targetWatts, code: targetZoneInfo.code })
            : t('freeride.controlsFreeStatus', {
                detail:
                  activeTransport === 'ant'
                    ? t('freeride.controlsFreeResistance', { pct: resistancePct })
                    : t('freeride.controlsFreeNoErg'),
              })}
        </div>

        <div>
          <button
            className={`btn btn-lg ${isPlaying ? 'btn-secondary' : 'btn-emerald'}`}
            style={{ minWidth: '200px', padding: '14px 32px', fontSize: '1.15rem', fontWeight: 800 }}
            onClick={handleTogglePlay}
          >
            {isPlaying ? (
              <>
                <Pause size={22} /> {t('player.pause')}
              </>
            ) : isFinished ? (
              <>
                <RotateCcw size={22} /> {t('player.repeat')}
              </>
            ) : elapsedSec > 0 ? (
              <>
                <Play size={22} fill="currentColor" /> {t('player.resume')}
              </>
            ) : (
              <>
                <Play size={22} fill="currentColor" /> {t('player.startRide')}
              </>
            )}
          </button>
        </div>

        <div>
          <button
            className="btn btn-danger"
            onClick={handleEndSession}
            disabled={recordedSamples.length < 1 && elapsedSec < 1}
          >
            <Square size={16} /> {t('player.endSession')}
          </button>
        </div>
      </div>

      {/* POST-RIDE SUMMARY / EXPORT MODAL */}
      {isFinished && summaryStats && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '580px' }}>
            <div className="modal-header">
              <div className="modal-title">
                <CheckCircle2 size={24} style={{ color: 'var(--accent-emerald)' }} />
                <span>{t('freeride.summaryTitle')}</span>
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
                  {sessionTitle}
                </h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {t('player.totalTimeCompleted')}{' '}
                  <strong style={{ color: 'var(--accent-cyan)' }}>
                    {formatTime(Math.floor(elapsedSec))}
                  </strong>
                </div>
              </div>

              {/* 6 Summary Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                  marginBottom: '24px',
                }}
              >
                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {t('player.avgWatts')}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff' }}>
                    {summaryStats.avgW} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>W</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#38bdf8', fontWeight: 600 }}>
                    {summaryStats.avgWkg} W/kg
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {t('player.maxWatts')}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#38bdf8' }}>
                    {summaryStats.maxW} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>W</span>
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {t('player.energyBurned')}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fb923c' }}>
                    {summaryStats.kcal} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>kcal</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    {t('player.mechanicalKj', { kj: summaryStats.workKj })}
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {t('player.avgCadence')}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#a78bfa' }}>
                    {summaryStats.avgCad} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>RPM</span>
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {t('player.distanceCovered')}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981' }}>
                    {summaryStats.totalDistKm}{' '}
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>km</span>
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {t('player.heartRate')}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f87171' }}>
                    {summaryStats.avgHr ? (
                      <>
                        {summaryStats.avgHr}{' '}
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('player.bpmUnit')}</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>--</span>
                    )}
                  </div>
                  {summaryStats.maxHr && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {t('player.maxHr', { hr: summaryStats.maxHr })}
                    </div>
                  )}
                </div>
              </div>

              {exportMessage && (
                <div className="alert-box alert-emerald" style={{ marginBottom: 16 }}>
                  <CheckCircle2 size={18} />
                  <span>{exportMessage}</span>
                </div>
              )}

              {garminUploadState === 'uploading' && (
                <div className="alert-box alert-cyan" style={{ marginBottom: 16 }}>
                  <Loader2 size={18} className="spin" />
                  <span>{t('player.garminUploading')}</span>
                </div>
              )}

              {garminUploadState === 'success' && garminResult && (
                <div className="alert-box alert-emerald garmin-upload-banner" style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CheckCircle2 size={18} />
                    <span className="garmin-success-badge">
                      {garminResult.duplicate
                        ? t('player.garminDuplicate')
                        : t('player.garminUploaded')}
                    </span>
                  </div>
                  {garminResult.activityUrl && (
                    <button
                      type="button"
                      className="btn btn-secondary garmin-external-btn"
                      onClick={() =>
                        window.electronAPI?.openExternalUrl(garminResult.activityUrl!)
                      }
                    >
                      {t('player.garminViewOn')} <ExternalLink size={14} />
                    </button>
                  )}
                </div>
              )}

              {garminUploadState === 'error' && garminResult && (
                <div className="alert-box alert-red garmin-upload-banner" style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                      {garminResult.needsRelogin
                        ? garminResult.error || t('player.garminSessionExpired')
                        : garminResult.error || t('player.garminUploadError')}
                    </span>
                  </div>
                  {garminResult.needsRelogin && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: '7px 12px', fontSize: '0.82rem', alignSelf: 'flex-end' }}
                      onClick={() => handleUploadToGarmin(true)}
                    >
                      {t('player.garminReconnectAndUpload')}
                    </button>
                  )}
                </div>
              )}

              {stravaUploadState === 'uploading' && (
                <div className="alert-box alert-cyan" style={{ marginBottom: 16 }}>
                  <Loader2 size={18} className="spin" />
                  <span>{t('player.stravaUploading')}</span>
                </div>
              )}

              {stravaUploadState === 'success' && stravaResult && (
                <div className="alert-box alert-emerald garmin-upload-banner" style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CheckCircle2 size={18} />
                    <span className="garmin-success-badge">
                      {stravaResult.duplicate
                        ? t('player.stravaDuplicate')
                        : t('player.stravaUploaded')}
                    </span>
                  </div>
                  {stravaResult.activityUrl && (
                    <button
                      type="button"
                      className="btn btn-secondary garmin-external-btn"
                      onClick={() =>
                        window.electronAPI?.openExternalStravaUrl?.(stravaResult.activityUrl!)
                      }
                    >
                      {t('player.stravaViewOn')} <ExternalLink size={14} />
                    </button>
                  )}
                </div>
              )}

              {stravaUploadState === 'error' && stravaResult && (
                <div className="alert-box alert-red garmin-upload-banner" style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                      {stravaResult.needsRelogin
                        ? stravaResult.error || t('player.stravaSessionExpired')
                        : stravaResult.error || t('player.stravaUploadError')}
                    </span>
                  </div>
                  {stravaResult.needsRelogin && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{
                        padding: '7px 12px',
                        fontSize: '0.82rem',
                        alignSelf: 'flex-end',
                        background: '#fc4c02',
                        borderColor: '#fc4c02',
                        color: '#fff',
                      }}
                      onClick={() => handleUploadToStrava(true)}
                    >
                      {t('player.stravaReconnectAndUpload')}
                    </button>
                  )}
                </div>
              )}

              {/* Export & Upload Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {garminUploadState !== 'success' && (
                  <button
                    className="btn btn-emerald"
                    style={{ padding: '12px', fontSize: '0.95rem' }}
                    disabled={garminUploadState === 'uploading'}
                    onClick={() => handleUploadToGarmin(false)}
                  >
                    {garminUploadState === 'uploading' ? (
                      <>
                        <Loader2 size={18} className="spin" /> {t('player.garminUploading')}
                      </>
                    ) : (
                      <>
                        <Upload size={18} /> {t('player.garminUploadBtn')}
                      </>
                    )}
                  </button>
                )}
                {stravaUploadState !== 'success' && (
                  <button
                    className="btn btn-primary"
                    style={{
                      padding: '12px',
                      fontSize: '0.95rem',
                      background: '#fc4c02',
                      borderColor: '#fc4c02',
                      color: '#fff',
                    }}
                    disabled={stravaUploadState === 'uploading'}
                    onClick={() => handleUploadToStrava(false)}
                  >
                    {stravaUploadState === 'uploading' ? (
                      <>
                        <Loader2 size={18} className="spin" /> {t('player.stravaUploading')}
                      </>
                    ) : (
                      <>
                        <Upload size={18} /> {t('player.stravaUploadBtn')}
                      </>
                    )}
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  style={{ padding: '12px', fontSize: '0.95rem' }}
                  onClick={handleExportTcx}
                >
                  <Download size={18} /> {t('player.saveTcx')}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '12px', fontSize: '0.95rem' }}
                  onClick={handleExportFit}
                >
                  <Download size={18} /> {t('player.saveFit')}
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
                {t('freeride.backToHome')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

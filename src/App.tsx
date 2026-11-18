import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap,
  Radio,
  Bluetooth,
  Cpu,
  Plus,
  Edit3,
  Copy,
  Trash2,
  Play,
  Clock,
  Activity,
  Layers,
  Settings,
  Flame,
  Volume2,
  VolumeX,
  Upload,
  User,
  Heart,
  X,
  CheckCircle2,
  Link2,
  Loader2,
  ArrowLeft,
  Wind,
} from 'lucide-react';
import {
  Workout,
  WorkoutBlock,
  UserSettings,
  ConnectionTransport,
  ConnectionStatus,
  DiscoveredDevice,
  TrainerTelemetry,
  TrainerStateEvent,
  HrSensorStateEvent,
  GarminStatus,
  StravaStatus,
} from './types/workout';
import { computeWorkoutStats, formatTime } from './utils/workoutMath';
import { parseWorkoutFileContent } from './utils/workoutImporter';
import { bleTrainer } from './services/bleTrainer';
import { simulatorTrainer } from './services/simulatorTrainer';
import { WorkoutChart } from './components/WorkoutChart';
import { ConnectionModal } from './components/ConnectionModal';
import { WorkoutBuilder } from './components/WorkoutBuilder';
import { WorkoutRidePlayer } from './components/WorkoutRidePlayer';
import { FreeRidePlayer } from './components/FreeRidePlayer';
import { NumericInput } from './components/NumericInput';
import { useI18n, LanguageToggle } from './i18n';

// Seeded default workouts if library is empty
const SEEDED_WORKOUTS: Workout[] = [
  {
    id: 'w-sweet-spot-3x10',
    name: 'Sweet Spot 3x10 min',
    description: 'Tres series de 10 minutos al 90% FTP para construir base aeróbica sólida y elevar el umbral sin fatiga excesiva.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blocks: [
      { id: 'b1', label: 'Calentamiento Progresivo', type: 'ramp', durationSec: 600, unit: 'ftp_percent', powerStart: 50, powerEnd: 75, cadenceTarget: 90 },
      { id: 'b2', label: 'Activación', type: 'steady', durationSec: 120, unit: 'ftp_percent', powerStart: 85, powerEnd: 85, cadenceTarget: 95 },
      { id: 'b3', label: 'Recuperación', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b4', label: 'Sweet Spot 1', type: 'steady', durationSec: 600, unit: 'ftp_percent', powerStart: 90, powerEnd: 90, cadenceTarget: 90 },
      { id: 'b5', label: 'Recuperación 1', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b6', label: 'Sweet Spot 2', type: 'steady', durationSec: 600, unit: 'ftp_percent', powerStart: 90, powerEnd: 90, cadenceTarget: 90 },
      { id: 'b7', label: 'Recuperación 2', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b8', label: 'Sweet Spot 3', type: 'steady', durationSec: 600, unit: 'ftp_percent', powerStart: 90, powerEnd: 90, cadenceTarget: 90 },
      { id: 'b9', label: 'Enfriamiento', type: 'ramp', durationSec: 360, unit: 'ftp_percent', powerStart: 65, powerEnd: 40, cadenceTarget: 85 },
    ],
  },
  {
    id: 'w-vo2-5x3',
    name: 'VO2 Max 5x3 min (Z5)',
    description: 'Intervalos cortos e intensos al 115% de FTP para potenciar el consumo máximo de oxígeno y tolerancia al lactato.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blocks: [
      { id: 'b1', label: 'Calentamiento Progresivo', type: 'ramp', durationSec: 720, unit: 'ftp_percent', powerStart: 45, powerEnd: 80, cadenceTarget: 90 },
      { id: 'b2', label: 'Recuperación Pre-Serie', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b3', label: 'VO2 Max 1', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 115, powerEnd: 115, cadenceTarget: 98 },
      { id: 'b4', label: 'Recuperación 1', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b5', label: 'VO2 Max 2', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 115, powerEnd: 115, cadenceTarget: 98 },
      { id: 'b6', label: 'Recuperación 2', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b7', label: 'VO2 Max 3', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 115, powerEnd: 115, cadenceTarget: 98 },
      { id: 'b8', label: 'Recuperación 3', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b9', label: 'VO2 Max 4', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 115, powerEnd: 115, cadenceTarget: 98 },
      { id: 'b10', label: 'Recuperación 4', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b11', label: 'VO2 Max 5 (¡Último esfuerzo!)', type: 'steady', durationSec: 180, unit: 'ftp_percent', powerStart: 115, powerEnd: 115, cadenceTarget: 100 },
      { id: 'b12', label: 'Enfriamiento', type: 'ramp', durationSec: 420, unit: 'ftp_percent', powerStart: 60, powerEnd: 40, cadenceTarget: 85 },
    ],
  },
  {
    id: 'w-ftp-test-20',
    name: 'Test FTP 20 min (Protocolo Estándar)',
    description: 'Test clásico para calibrar tu FTP: 20 min al 100% tras vaciado de anaeróbico. Tu nuevo FTP será el 95% de la media sostenida.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blocks: [
      { id: 'b1', label: 'Calentamiento Suave', type: 'ramp', durationSec: 600, unit: 'ftp_percent', powerStart: 45, powerEnd: 70, cadenceTarget: 90 },
      { id: 'b2', label: 'Vaciado Anaeróbico', type: 'steady', durationSec: 300, unit: 'ftp_percent', powerStart: 110, powerEnd: 110, cadenceTarget: 95 },
      { id: 'b3', label: 'Recuperación Total', type: 'steady', durationSec: 600, unit: 'ftp_percent', powerStart: 50, powerEnd: 50, cadenceTarget: 85 },
      { id: 'b4', label: 'TEST 20 MINUTOS A TOPE', type: 'steady', durationSec: 1200, unit: 'ftp_percent', powerStart: 100, powerEnd: 100, cadenceTarget: 92 },
      { id: 'b5', label: 'Enfriamiento Completo', type: 'ramp', durationSec: 600, unit: 'ftp_percent', powerStart: 55, powerEnd: 35, cadenceTarget: 80 },
    ],
  },
  {
    id: 'w-endurance-60',
    name: 'Resistencia Aeróbica Z2 (60 min)',
    description: 'Entrenamiento continuo en Zona 2 para optimizar la eficiencia metabólica y el uso de grasas como combustible.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blocks: [
      { id: 'b1', label: 'Calentamiento Progresivo', type: 'ramp', durationSec: 600, unit: 'ftp_percent', powerStart: 50, powerEnd: 68, cadenceTarget: 90 },
      { id: 'b2', label: 'Ritmo Constante Z2', type: 'steady', durationSec: 2700, unit: 'ftp_percent', powerStart: 70, powerEnd: 70, cadenceTarget: 90 },
      { id: 'b3', label: 'Enfriamiento', type: 'ramp', durationSec: 300, unit: 'ftp_percent', powerStart: 60, powerEnd: 40, cadenceTarget: 85 },
    ],
  },
];

const SEEDED_WORKOUT_DEFAULTS = new Map(
  SEEDED_WORKOUTS.map((w) => [w.id, { name: w.name, description: w.description ?? '' }])
);

/**
 * Returns localized title and description for built-in preset workouts unless the user customized them.
 */
function getLocalizedWorkoutText(
  workout: Workout,
  t: (key: string, vars?: Record<string, string | number>) => string
): { name: string; description: string } {
  const preset = SEEDED_WORKOUT_DEFAULTS.get(workout.id);
  if (!preset) {
    return {
      name: workout.name,
      description: workout.description || t('app.library.defaultDesc'),
    };
  }
  return {
    name: workout.name === preset.name ? t(`app.preset.${workout.id}.name`) : workout.name,
    description:
      (workout.description ?? '') === preset.description
        ? t(`app.preset.${workout.id}.desc`)
        : workout.description || t('app.library.defaultDesc'),
  };
}

const DEFAULT_SETTINGS: UserSettings = {
  ftp: 240,
  weightKg: 72,
  maxHr: 190,
  restingHr: 55,
  age: 35,
  soundEnabled: true,
  preferredTransport: 'ant',
  powerSmoothingSec: 3,
};

export const App: React.FC = () => {
  const { t } = useI18n();
  // Views: 'home' | 'library' | 'builder' | 'player' | 'free_ride'
  const [currentView, setCurrentView] = useState<'home' | 'library' | 'builder' | 'player' | 'free_ride'>('home');
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  // Connection Modal & Hardware State
  const [isConnModalOpen, setIsConnModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [activeTransport, setActiveTransport] = useState<ConnectionTransport>('none');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [deviceName, setDeviceName] = useState<string | undefined>();
  const [stickName, setStickName] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [discoveredAntDevices, setDiscoveredAntDevices] = useState<DiscoveredDevice[]>([]);
  const [discoveredBleDevices, setDiscoveredBleDevices] = useState<{ deviceId: string; deviceName: string }[]>([]);

  // ANT+ HR Sensor State
  const [hrStatus, setHrStatus] = useState<ConnectionStatus>('disconnected');
  const [hrDeviceName, setHrDeviceName] = useState<string | undefined>();
  const [hrDeviceId, setHrDeviceId] = useState<number | undefined>();
  const [hrBpm, setHrBpm] = useState<number | undefined>();
  const [hrBatteryStatus, setHrBatteryStatus] = useState<string | undefined>();
  const [hrErrorMessage, setHrErrorMessage] = useState<string | undefined>();
  const liveAntHrRef = useRef<number | undefined>(undefined);

  // Garmin Connect session state
  const [garminStatus, setGarminStatus] = useState<GarminStatus>({ connected: false });
  const [garminAuthBusy, setGarminAuthBusy] = useState(false);
  const [garminAuthError, setGarminAuthError] = useState<string | null>(null);

  // Strava session state
  const [stravaStatus, setStravaStatus] = useState<StravaStatus>({ connected: false });
  const [stravaAuthBusy, setStravaAuthBusy] = useState(false);
  const [stravaAuthError, setStravaAuthError] = useState<string | null>(null);

  // Telemetry stream from rodillo
  const [telemetry, setTelemetry] = useState<TrainerTelemetry>({
    timestamp: Date.now(),
    powerWatts: 0,
    targetWatts: 100,
    cadenceRpm: 0,
    speedKmh: 0,
    distanceMeters: 0,
  });

  // Load initial data from Electron or LocalStorage
  useEffect(() => {
    const initData = async () => {
      let loadedWorkouts: Workout[] | null = null;
      let loadedSettings: UserSettings | null = null;

      if (window.electronAPI?.loadData) {
        try {
          const data = await window.electronAPI.loadData();
          if (data.workouts && data.workouts.length > 0) {
            loadedWorkouts = data.workouts;
          }
          if (data.settings && data.settings.ftp) {
            loadedSettings = data.settings;
          }
        } catch (e) {
          console.warn('Error loading data via electronAPI, falling back to localStorage', e);
        }
      }

      if (!loadedWorkouts) {
        try {
          const raw = localStorage.getItem('rulo_workouts');
          if (raw) loadedWorkouts = JSON.parse(raw);
        } catch (e) {
          // ignore
        }
      }

      if (!loadedSettings) {
        try {
          const raw = localStorage.getItem('rulo_settings');
          if (raw) loadedSettings = JSON.parse(raw);
        } catch (e) {
          // ignore
        }
      }

      setWorkouts(loadedWorkouts && loadedWorkouts.length > 0 ? loadedWorkouts : SEEDED_WORKOUTS);
      setSettings(
        loadedSettings
          ? {
              ...DEFAULT_SETTINGS,
              ...loadedSettings,
              powerSmoothingSec: loadedSettings.powerSmoothingSec ?? 3,
            }
          : DEFAULT_SETTINGS
      );
    };

    initData();
  }, []);

  // Initialize Garmin Connect connection status on mount
  useEffect(() => {
    const initGarmin = async () => {
      if (!window.electronAPI?.garminGetStatus) return;
      try {
        const status = await window.electronAPI.garminGetStatus();
        if (status) {
          setGarminStatus(status);
        }
      } catch (e) {
        console.warn('Error checking Garmin Connect status', e);
      }
    };
    initGarmin();
  }, []);

  const handleGarminLogin = useCallback(async () => {
    if (!window.electronAPI?.garminLogin) {
      return {
        ok: false,
        connected: false,
        error: t('app.garmin.desktopOnly'),
      };
    }
    setGarminAuthBusy(true);
    setGarminAuthError(null);
    try {
      const res = await window.electronAPI.garminLogin();
      setGarminStatus({
        connected: res.connected,
        displayName: res.displayName,
        lastVerifiedAt: res.connected ? new Date().toISOString() : undefined,
      });
      if (!res.ok && res.error) {
        setGarminAuthError(res.error);
      }
      return res;
    } catch (err) {
      const msg = (err as Error).message || t('app.garmin.connectError');
      setGarminAuthError(msg);
      return { ok: false, connected: false, error: msg };
    } finally {
      setGarminAuthBusy(false);
    }
  }, [t]);

  const handleGarminLogout = useCallback(async () => {
    setGarminAuthBusy(true);
    setGarminAuthError(null);
    try {
      if (window.electronAPI?.garminLogout) {
        await window.electronAPI.garminLogout();
      }
      setGarminStatus({ connected: false });
    } finally {
      setGarminAuthBusy(false);
    }
  }, []);

  // Initialize Strava connection status on mount
  useEffect(() => {
    const initStrava = async () => {
      if (!window.electronAPI?.stravaGetStatus) return;
      try {
        const status = await window.electronAPI.stravaGetStatus();
        if (status) {
          setStravaStatus(status);
        }
      } catch (e) {
        console.warn('Error checking Strava status', e);
      }
    };
    initStrava();
  }, []);

  const handleStravaLogin = useCallback(async () => {
    if (!window.electronAPI?.stravaLogin) {
      return {
        ok: false,
        connected: false,
        error: t('app.strava.desktopOnly'),
      };
    }
    setStravaAuthBusy(true);
    setStravaAuthError(null);
    try {
      const res = await window.electronAPI.stravaLogin();
      setStravaStatus({
        connected: res.connected,
        displayName: res.displayName,
        lastVerifiedAt: res.connected ? new Date().toISOString() : undefined,
      });
      if (!res.ok && res.error) {
        setStravaAuthError(res.error);
      }
      return res;
    } catch (err) {
      const msg = (err as Error).message || t('app.strava.connectError');
      setStravaAuthError(msg);
      return { ok: false, connected: false, error: msg };
    } finally {
      setStravaAuthBusy(false);
    }
  }, [t]);

  const handleStravaLogout = useCallback(async () => {
    setStravaAuthBusy(true);
    setStravaAuthError(null);
    try {
      if (window.electronAPI?.stravaLogout) {
        await window.electronAPI.stravaLogout();
      }
      setStravaStatus({ connected: false });
    } finally {
      setStravaAuthBusy(false);
    }
  }, []);

  // Save workouts when changed
  const handleSaveWorkoutsList = useCallback(
    async (updated: Workout[]) => {
      setWorkouts(updated);
      try {
        localStorage.setItem('rulo_workouts', JSON.stringify(updated));
      } catch (e) {
        // ignore
      }
      if (window.electronAPI?.saveWorkouts) {
        await window.electronAPI.saveWorkouts(updated);
      }
    },
    []
  );

  // Save settings when changed
  const handleUpdateSettings = useCallback(
    async (newSettings: Partial<UserSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...newSettings };
        try {
          localStorage.setItem('rulo_settings', JSON.stringify(next));
        } catch (e) {
          // ignore
        }
        if (window.electronAPI?.saveSettings) {
          window.electronAPI.saveSettings(next);
        }
        return next;
      });
    },
    []
  );

  // Electron ANT+ & BLE Event Subscriptions
  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubAntState = window.electronAPI.onAntState?.((state: TrainerStateEvent) => {
      setActiveTransport(state.transport);
      setConnectionStatus(state.status);
      if (state.deviceName) setDeviceName(state.deviceName);
      if (state.antStickType) setStickName(state.antStickType);
      if (state.errorMessage) setErrorMessage(state.errorMessage);
      else if (state.status === 'connected') setErrorMessage(undefined);
    });

    const unsubAntDevices = window.electronAPI.onAntDevices?.((devices: DiscoveredDevice[]) => {
      setDiscoveredAntDevices(devices);
    });

    const unsubAntTelemetry = window.electronAPI.onAntTelemetry?.((telem: TrainerTelemetry) => {
      setTelemetry(telem);
    });

    const unsubBleList = window.electronAPI.onBluetoothDeviceList?.((devices) => {
      setDiscoveredBleDevices(devices);
    });

    const unsubAntHrState = window.electronAPI.onAntHrState?.((state: HrSensorStateEvent) => {
      setHrStatus(state.status);
      if (state.deviceName) setHrDeviceName(state.deviceName);
      if (state.deviceId) setHrDeviceId(state.deviceId);
      if (state.batteryStatus) setHrBatteryStatus(state.batteryStatus);
      if (state.errorMessage) setHrErrorMessage(state.errorMessage);
      else if (state.status === 'connected') setHrErrorMessage(undefined);

      if (state.status === 'disconnected' || !state.heartRateBpm || state.heartRateBpm <= 0) {
        liveAntHrRef.current = undefined;
        setHrBpm(undefined);
        setTelemetry((prev) =>
          prev.heartRateBpm === undefined ? prev : { ...prev, heartRateBpm: undefined }
        );
      } else {
        liveAntHrRef.current = state.heartRateBpm;
        setHrBpm(state.heartRateBpm);
        // Inject into telemetry so heart rate is recorded and displayed everywhere
        setTelemetry((prev) => ({
          ...prev,
          heartRateBpm: state.heartRateBpm,
        }));
      }
    });

    return () => {
      unsubAntState?.();
      unsubAntDevices?.();
      unsubAntTelemetry?.();
      unsubBleList?.();
      unsubAntHrState?.();
    };
  }, []);

  // Disconnect active trainer
  const handleDisconnectActiveTrainer = useCallback(async () => {
    if (activeTransport === 'ant' && window.electronAPI?.antDisconnect) {
      await window.electronAPI.antDisconnect();
    } else if (activeTransport === 'ble') {
      await bleTrainer.disconnect();
    } else if (activeTransport === 'simulator') {
      simulatorTrainer.disconnect();
    }

    setActiveTransport('none');
    setConnectionStatus('disconnected');
    setDeviceName(undefined);
  }, [activeTransport]);

  // Connect ANT+
  const handleStartAntScan = useCallback(async () => {
    setErrorMessage(undefined);
    setConnectionStatus('scanning');
    if (window.electronAPI?.antStartScan) {
      const res = await window.electronAPI.antStartScan();
      if (!res.ok) {
        setConnectionStatus('error');
        setErrorMessage(res.error || t('app.conn.antScanError'));
      } else if (res.stickName) {
        setStickName(res.stickName);
      }
    } else {
      setConnectionStatus('error');
      setErrorMessage(t('app.conn.antElectronRequired'));
    }
  }, [t]);

  const handleConnectAntDevice = useCallback(
    async (deviceId: number) => {
      setErrorMessage(undefined);
      setConnectionStatus('connecting');
      setActiveTransport('ant');

      if (window.electronAPI?.antConnectDevice) {
        const res = await window.electronAPI.antConnectDevice(deviceId);
        if (!res.ok) {
          setConnectionStatus('error');
          setErrorMessage(res.error || t('app.conn.antConnectError'));
        } else {
          setConnectionStatus('connected');
          setDeviceName(deviceId === 0 ? 'Tacx Neo 2 (Auto)' : `Tacx Neo 2 (#${deviceId})`);
          handleUpdateSettings({ lastAntDeviceId: deviceId, preferredTransport: 'ant' });
        }
      } else {
        setConnectionStatus('error');
        setErrorMessage(t('app.conn.antElectronShort'));
      }
    },
    [handleUpdateSettings, t]
  );

  // Connect Bluetooth
  const handleConnectBle = useCallback(async () => {
    setErrorMessage(undefined);
    setConnectionStatus('connecting');
    setActiveTransport('ble');

    try {
      await bleTrainer.connect(
        (t) => setTelemetry({ ...t, heartRateBpm: liveAntHrRef.current ?? t.heartRateBpm }),
        (s) => {
          setActiveTransport(s.transport);
          setConnectionStatus(s.status);
          if (s.deviceName) setDeviceName(s.deviceName);
          if (s.errorMessage) setErrorMessage(s.errorMessage);
        }
      );
      handleUpdateSettings({ preferredTransport: 'ble' });
    } catch (err) {
      setConnectionStatus('error');
      setErrorMessage((err as Error).message || t('app.conn.bleConnectError'));
    }
  }, [handleUpdateSettings, t]);

  const handleSelectBleDevice = useCallback((deviceId: string) => {
    if (window.electronAPI?.selectBluetoothDevice) {
      window.electronAPI.selectBluetoothDevice(deviceId);
    }
  }, []);

  // Connect Simulator
  const handleConnectSimulator = useCallback(async () => {
    // If another trainer was active, disconnect it first
    await handleDisconnectActiveTrainer();

    setActiveTransport('simulator');
    setConnectionStatus('connected');
    setDeviceName(t('app.conn.simDeviceName'));

    simulatorTrainer.connect(
      (telem: TrainerTelemetry) =>
        setTelemetry({ ...telem, heartRateBpm: liveAntHrRef.current ?? telem.heartRateBpm }),
      (s: TrainerStateEvent) => {
        setActiveTransport(s.transport);
        setConnectionStatus(s.status);
        if (s.deviceName) setDeviceName(s.deviceName);
      }
    );
    handleUpdateSettings({ preferredTransport: 'simulator' });
  }, [handleDisconnectActiveTrainer, handleUpdateSettings, t]);

  // Connect & Disconnect ANT+ Heart Rate Strap (Channel 1)
  const handleConnectAntHr = useCallback(
    async (deviceId: number = 0) => {
      setHrErrorMessage(undefined);
      setHrStatus('connecting');

      if (window.electronAPI?.antConnectHr) {
        const res = await window.electronAPI.antConnectHr(deviceId);
        if (!res.ok) {
          setHrStatus('error');
          setHrErrorMessage(res.error || t('app.conn.hrConnectError'));
        } else {
          setHrStatus('connected');
          setHrDeviceName(
            deviceId === 0 ? t('app.conn.hrAutoName') : t('app.conn.hrNamed', { id: deviceId })
          );
          handleUpdateSettings({ lastAntHrDeviceId: deviceId });
        }
      } else {
        setHrStatus('error');
        setHrErrorMessage(t('app.conn.hrElectronRequired'));
      }
    },
    [handleUpdateSettings, t]
  );

  const handleDisconnectAntHr = useCallback(async () => {
    if (window.electronAPI?.antDisconnectHr) {
      await window.electronAPI.antDisconnectHr();
    }
    setHrStatus('disconnected');
    setHrDeviceName(undefined);
    setHrBpm(undefined);
    setHrBatteryStatus(undefined);
    setTelemetry((prev) => ({ ...prev, heartRateBpm: undefined }));
  }, []);

  // Send Target Power to Active Trainer (Unified router)
  const sendTargetPowerToActiveTrainer = useCallback(
    (watts: number) => {
      if (activeTransport === 'ant' && window.electronAPI?.antSetTargetPower) {
        window.electronAPI.antSetTargetPower(watts);
      } else if (activeTransport === 'ble') {
        bleTrainer.setTargetPower(watts);
      } else if (activeTransport === 'simulator') {
        simulatorTrainer.setTargetPower(watts);
      }
    },
    [activeTransport]
  );

  // Workout Library Actions
  const handleStartRide = (workout: Workout) => {
    setActiveWorkout(workout);
    setCurrentView('player');
  };

  const handleEditWorkout = (workout: Workout) => {
    setActiveWorkout(workout);
    setCurrentView('builder');
  };

  const handleCreateNewWorkout = () => {
    setActiveWorkout(null);
    setCurrentView('builder');
  };

  const handleDuplicateWorkout = (workout: Workout) => {
    const clone: Workout = {
      ...workout,
      id: `w-${Date.now()}`,
      name: `${workout.name} ${t('app.workout.copySuffix')}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    handleSaveWorkoutsList([clone, ...workouts]);
  };

  const handleDeleteWorkout = (workoutId: string) => {
    if (confirm(t('app.workout.deleteConfirm'))) {
      handleSaveWorkoutsList(workouts.filter((w) => w.id !== workoutId));
    }
  };

  const handleSaveFromBuilder = (savedWorkout: Workout) => {
    const exists = workouts.some((w) => w.id === savedWorkout.id);
    let updated: Workout[];
    if (exists) {
      updated = workouts.map((w) => (w.id === savedWorkout.id ? savedWorkout : w));
    } else {
      updated = [savedWorkout, ...workouts];
    }
    handleSaveWorkoutsList(updated);
    setCurrentView('library');
    setActiveWorkout(null);
  };

  const handleImportMultipleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const importedAll: Workout[] = [];
    const errors: string[] = [];

    for (const file of Array.from(fileList)) {
      try {
        const text = await file.text();
        const parsed = parseWorkoutFileContent(file.name, text);
        importedAll.push(...parsed);
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
      }
    }

    if (importedAll.length > 0) {
      await handleSaveWorkoutsList([...importedAll, ...workouts]);
    }
    if (errors.length > 0) {
      alert(t('app.workout.importError', { errors: errors.join('\n') }));
    }
    e.target.value = '';
  };

  const connectionModalElement = (
    <ConnectionModal
      isOpen={isConnModalOpen}
      onClose={() => setIsConnModalOpen(false)}
      activeTransport={activeTransport}
      connectionStatus={connectionStatus}
      deviceName={deviceName}
      stickName={stickName}
      errorMessage={errorMessage}
      discoveredAntDevices={discoveredAntDevices}
      discoveredBleDevices={discoveredBleDevices}
      onStartAntScan={handleStartAntScan}
      onConnectAntDevice={handleConnectAntDevice}
      onConnectBle={handleConnectBle}
      onSelectBleDevice={handleSelectBleDevice}
      onConnectSimulator={handleConnectSimulator}
      onDisconnect={handleDisconnectActiveTrainer}
      hrStatus={hrStatus}
      hrDeviceName={hrDeviceName}
      hrDeviceId={hrDeviceId}
      hrBpm={hrBpm}
      hrBatteryStatus={hrBatteryStatus}
      hrErrorMessage={hrErrorMessage}
      onConnectAntHr={handleConnectAntHr}
      onDisconnectAntHr={handleDisconnectAntHr}
    />
  );

  const profileModalElement = isProfileModalOpen && (
    <div className="modal-overlay" onClick={() => setIsProfileModalOpen(false)}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '520px' }}
      >
        <div className="modal-header">
          <div className="modal-title">
            <User size={22} style={{ color: 'var(--accent-cyan)' }} />
            <span>{t('app.profile.title')}</span>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setIsProfileModalOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              borderRadius: '10px',
              padding: '12px 14px',
              marginBottom: '18px',
              fontSize: '0.82rem',
              color: '#bae6fd',
              lineHeight: 1.45,
            }}
          >
            💡 <strong>{t('app.profile.scienceLabel')}</strong> {t('app.profile.scienceText1')}
            <strong>{t('app.profile.scienceBold1')}</strong>
            {t('app.profile.scienceText2')}
            <strong>{t('app.profile.scienceBold2')}</strong>
            {t('app.profile.scienceText3')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label className="form-label">{t('app.profile.weightLabel')}</label>
              <NumericInput
                min={1}
                allowDecimal
                fallback={70}
                className="input-number"
                value={settings.weightKg}
                onChange={(val) => handleUpdateSettings({ weightKg: val })}
              />
              <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: 4 }}>
                {t('app.profile.ratio', {
                  ratio: (settings.ftp / Math.max(30, settings.weightKg)).toFixed(2),
                })}
              </div>
            </div>

            <div>
              <label className="form-label">{t('app.profile.ftpLabel')}</label>
              <NumericInput
                min={1}
                fallback={200}
                className="input-number"
                value={settings.ftp}
                onChange={(val) => handleUpdateSettings({ ftp: val })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label className="form-label">{t('app.profile.maxHrLabel')}</label>
              <NumericInput
                min={1}
                fallback={190}
                className="input-number"
                value={settings.maxHr}
                onChange={(val) => handleUpdateSettings({ maxHr: val })}
              />
            </div>

            <div>
              <label className="form-label">{t('app.profile.restingHrLabel')}</label>
              <NumericInput
                min={1}
                fallback={55}
                className="input-number"
                value={settings.restingHr}
                onChange={(val) => handleUpdateSettings({ restingHr: val })}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 4 }}>
                {t('app.profile.karvonenHint')}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label className="form-label">{t('app.profile.ageLabel')}</label>
              <NumericInput
                min={1}
                allowEmpty
                placeholder="35"
                fallback={35}
                className="input-number"
                value={settings.age}
                onChangeOptional={(val) => handleUpdateSettings({ age: val })}
              />
            </div>

            <div>
              <label className="form-label">{t('app.profile.smoothingLabel')}</label>
              <select
                className="select-input"
                value={settings.powerSmoothingSec ?? 3}
                onChange={(e) =>
                  handleUpdateSettings({
                    powerSmoothingSec: (parseInt(e.target.value) || 3) as 0 | 3 | 5,
                  })
                }
              >
                <option value={0}>{t('app.profile.smoothing0')}</option>
                <option value={3}>{t('app.profile.smoothing3')}</option>
                <option value={5}>{t('app.profile.smoothing5')}</option>
              </select>
            </div>
          </div>

          {/* Garmin Connect Integration Section */}
          <div className="garmin-profile-section">
            <div className="garmin-profile-header">
              <div>
                <div className="garmin-profile-title">
                  <Link2 size={16} style={{ color: 'var(--accent-cyan)' }} />
                  <span>{t('app.garmin.title')}</span>
                </div>
                <div className="garmin-profile-status">
                  {garminStatus.connected ? (
                    <span className="garmin-status-connected">
                      <CheckCircle2 size={14} /> {t('app.garmin.connectedAs')}{' '}
                      <strong>{garminStatus.displayName || t('app.garmin.defaultUser')}</strong>
                    </span>
                  ) : (
                    <span className="garmin-status-disconnected">{t('app.garmin.notLinked')}</span>
                  )}
                </div>
              </div>

              {garminStatus.connected ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ padding: '7px 12px', fontSize: '0.82rem' }}
                  disabled={garminAuthBusy}
                  onClick={handleGarminLogout}
                >
                  {garminAuthBusy ? <Loader2 size={14} className="spin" /> : t('app.garmin.unlink')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '7px 14px', fontSize: '0.82rem' }}
                  disabled={garminAuthBusy}
                  onClick={handleGarminLogin}
                >
                  {garminAuthBusy ? (
                    <>
                      <Loader2 size={14} className="spin" /> {t('app.garmin.connecting')}
                    </>
                  ) : (
                    t('app.garmin.link')
                  )}
                </button>
              )}
            </div>

            {garminAuthError && (
              <div className="garmin-profile-error">{garminAuthError}</div>
            )}

            <label className="garmin-auto-upload-toggle">
              <input
                type="checkbox"
                checked={Boolean(settings.autoUploadGarmin)}
                onChange={(e) =>
                  handleUpdateSettings({ autoUploadGarmin: e.target.checked })
                }
              />
              <span>{t('app.garmin.autoUpload')}</span>
            </label>
          </div>

          {/* Strava Integration Section */}
          <div className="garmin-profile-section" style={{ marginTop: '12px' }}>
            <div className="garmin-profile-header">
              <div>
                <div className="garmin-profile-title">
                  <Link2 size={16} style={{ color: '#fc4c02' }} />
                  <span>{t('app.strava.title')}</span>
                </div>
                <div className="garmin-profile-status">
                  {stravaStatus.connected ? (
                    <span className="garmin-status-connected">
                      <CheckCircle2 size={14} /> {t('app.strava.connectedAs')}{' '}
                      <strong>{stravaStatus.displayName || t('app.strava.defaultUser')}</strong>
                    </span>
                  ) : (
                    <span className="garmin-status-disconnected">{t('app.strava.notLinked')}</span>
                  )}
                </div>
              </div>

              {stravaStatus.connected ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ padding: '7px 12px', fontSize: '0.82rem' }}
                  disabled={stravaAuthBusy}
                  onClick={handleStravaLogout}
                >
                  {stravaAuthBusy ? <Loader2 size={14} className="spin" /> : t('app.strava.unlink')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    padding: '7px 14px',
                    fontSize: '0.82rem',
                    background: '#fc4c02',
                    borderColor: '#fc4c02',
                    color: '#fff',
                  }}
                  disabled={stravaAuthBusy}
                  onClick={handleStravaLogin}
                >
                  {stravaAuthBusy ? (
                    <>
                      <Loader2 size={14} className="spin" /> {t('app.strava.connecting')}
                    </>
                  ) : (
                    t('app.strava.link')
                  )}
                </button>
              )}
            </div>

            {stravaAuthError && (
              <div className="garmin-profile-error">{stravaAuthError}</div>
            )}

            <label className="garmin-auto-upload-toggle">
              <input
                type="checkbox"
                checked={Boolean(settings.autoUploadStrava)}
                onChange={(e) =>
                  handleUpdateSettings({ autoUploadStrava: e.target.checked })
                }
              />
              <span>{t('app.strava.autoUpload')}</span>
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-emerald"
            onClick={() => setIsProfileModalOpen(false)}
          >
            {t('app.profile.saveClose')}
          </button>
        </div>
      </div>
    </div>
  );

  const renderTopHeader = (showLibraryActions: boolean) => (
    <header className="app-header">
      <div className="brand-section">
        {showLibraryActions && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            onClick={() => setCurrentView('home')}
            title={t('app.header.homeTitle')}
          >
            <ArrowLeft size={16} /> {t('app.header.home')}
          </button>
        )}
        <img
          src="./favicon.png"
          alt="RuLo"
          style={{ width: 38, height: 38, borderRadius: 9, display: 'block', cursor: 'pointer' }}
          onClick={() => setCurrentView('home')}
        />
        <div
          className="brand-title"
          style={{ cursor: 'pointer' }}
          onClick={() => setCurrentView('home')}
        >
          RuLo
        </div>
      </div>

      <div className="header-actions">
        {/* Quick inline FTP & W/kg Editor */}
        <div className="ftp-badge-pill" title={t('app.header.ftpTitle')}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>FTP:</span>
          <NumericInput
            className="ftp-input"
            value={settings.ftp}
            min={1}
            fallback={200}
            onChange={(val) => handleUpdateSettings({ ftp: val })}
          />
          <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: '0.85rem' }}>W</span>
          <span style={{ color: '#38bdf8', fontSize: '0.8rem', fontWeight: 600, borderLeft: '1px solid #334155', paddingLeft: 6 }}>
            {(settings.ftp / Math.max(30, settings.weightKg || 72)).toFixed(2)} W/kg
          </span>
        </div>

        {/* Cyclist Profile Button */}
        <button
          className="btn btn-secondary"
          onClick={() => setIsProfileModalOpen(true)}
          title={t('app.header.profileTitle')}
          style={{ padding: '6px 12px', fontSize: '0.82rem' }}
        >
          <User size={15} /> {t('app.header.profileBtn')}
        </button>

        {/* Quick HR Strap Status Pill in Header */}
        {hrStatus === 'connected' && (
          <div
            className="connection-pill"
            onClick={() => setIsConnModalOpen(true)}
            title={t('app.header.hrTitle')}
            style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)' }}
          >
            <Heart size={14} fill="#ef4444" color="#ef4444" className="animate-pulse" />
            <span style={{ color: '#fca5a5', fontWeight: 700, fontSize: '0.85rem' }}>
              {hrBpm ? `${hrBpm} ${t('app.header.bpmUnit')}` : t('app.header.hrFallback')}
            </span>
          </div>
        )}

        {/* Sound Toggle */}
        <button
          className="btn btn-secondary btn-icon"
          onClick={() => handleUpdateSettings({ soundEnabled: !settings.soundEnabled })}
          title={settings.soundEnabled ? t('app.header.soundOnTitle') : t('app.header.soundOffTitle')}
        >
          {settings.soundEnabled ? (
            <Volume2 size={18} style={{ color: 'var(--accent-cyan)' }} />
          ) : (
            <VolumeX size={18} style={{ color: 'var(--text-dim)' }} />
          )}
        </button>

        {/* Connection Status Button */}
        <div
          className="connection-pill"
          onClick={() => setIsConnModalOpen(true)}
          title={t('app.header.connTitle')}
        >
          <span
            className={`status-dot ${
              connectionStatus === 'connected'
                ? 'connected'
                : connectionStatus === 'connecting' || connectionStatus === 'scanning'
                ? 'connecting'
                : connectionStatus === 'error'
                ? 'error'
                : 'disconnected'
            }`}
          />
          {activeTransport === 'ant' ? (
            <Radio size={14} style={{ color: 'var(--accent-cyan)' }} />
          ) : activeTransport === 'ble' ? (
            <Bluetooth size={14} style={{ color: 'var(--accent-cyan)' }} />
          ) : activeTransport === 'simulator' ? (
            <Cpu size={14} style={{ color: 'var(--accent-emerald)' }} />
          ) : (
            <Zap size={14} style={{ color: 'var(--text-muted)' }} />
          )}
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            {connectionStatus === 'connected'
              ? deviceName || 'Tacx Neo 2'
              : t('app.header.connectTrainer')}
          </span>
        </div>

        {showLibraryActions && (
          <>
            {/* Import Workout Button */}
            <label
              htmlFor="library-import-input"
              className="btn btn-secondary"
              style={{ cursor: 'pointer' }}
              title={t('app.header.importTitle')}
            >
              <Upload size={16} /> {t('app.header.import')}
            </label>
            <input
              id="library-import-input"
              type="file"
              multiple
              accept=".zwo,.mrc,.erg,.json"
              style={{ display: 'none' }}
              onChange={handleImportMultipleFiles}
            />

            {/* Create Workout Button */}
            <button className="btn btn-primary" onClick={handleCreateNewWorkout}>
              <Plus size={16} /> {t('app.header.newWorkout')}
            </button>
          </>
        )}

        <LanguageToggle />
      </div>
    </header>
  );

  // Render view
  if (currentView === 'player' && activeWorkout) {
    return (
      <>
        <WorkoutRidePlayer
          workout={activeWorkout}
          ftp={settings.ftp}
          weightKg={settings.weightKg}
          maxHr={settings.maxHr}
          restingHr={settings.restingHr}
          age={settings.age}
          soundEnabled={settings.soundEnabled}
          sessionFieldModes={settings.sessionFieldModes}
          onUpdateSessionFieldModes={(modes) => handleUpdateSettings({ sessionFieldModes: modes })}
          powerSmoothingSec={settings.powerSmoothingSec ?? 3}
          onUpdatePowerSmoothing={(sec) => handleUpdateSettings({ powerSmoothingSec: sec })}
          onToggleSound={() => handleUpdateSettings({ soundEnabled: !settings.soundEnabled })}
          onExit={() => {
            setCurrentView('library');
            setActiveWorkout(null);
          }}
          telemetry={telemetry}
          activeTransport={activeTransport}
          connectionStatus={connectionStatus}
          deviceName={deviceName}
          onOpenConnectionModal={() => setIsConnModalOpen(true)}
          sendTargetPowerToActiveTrainer={sendTargetPowerToActiveTrainer}
          garminStatus={garminStatus}
          autoUploadGarmin={Boolean(settings.autoUploadGarmin)}
          onGarminLogin={handleGarminLogin}
        />
        {connectionModalElement}
      </>
    );
  }

  if (currentView === 'free_ride') {
    return (
      <>
        <FreeRidePlayer
          ftp={settings.ftp}
          weightKg={settings.weightKg}
          maxHr={settings.maxHr}
          restingHr={settings.restingHr}
          age={settings.age}
          soundEnabled={settings.soundEnabled}
          sessionFieldModes={settings.sessionFieldModes}
          onUpdateSessionFieldModes={(modes) => handleUpdateSettings({ sessionFieldModes: modes })}
          powerSmoothingSec={settings.powerSmoothingSec ?? 3}
          onUpdatePowerSmoothing={(sec) => handleUpdateSettings({ powerSmoothingSec: sec })}
          onToggleSound={() => handleUpdateSettings({ soundEnabled: !settings.soundEnabled })}
          onExit={() => setCurrentView('home')}
          telemetry={telemetry}
          activeTransport={activeTransport}
          connectionStatus={connectionStatus}
          deviceName={deviceName}
          onOpenConnectionModal={() => setIsConnModalOpen(true)}
          sendTargetPowerToActiveTrainer={sendTargetPowerToActiveTrainer}
          garminStatus={garminStatus}
          autoUploadGarmin={Boolean(settings.autoUploadGarmin)}
          onGarminLogin={handleGarminLogin}
        />
        {connectionModalElement}
      </>
    );
  }

  if (currentView === 'builder') {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="brand-section">
            <img
              src="./favicon.png"
              alt="RuLo"
              style={{ width: 38, height: 38, borderRadius: 9, display: 'block' }}
            />
            <div className="brand-title">RuLo</div>
          </div>
          <div className="header-actions">
            <div className="ftp-badge-pill">
              <span style={{ color: 'var(--text-muted)' }}>FTP:</span>
              <NumericInput
                className="ftp-input"
                value={settings.ftp}
                min={1}
                fallback={200}
                onChange={(val) => handleUpdateSettings({ ftp: val })}
              />
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>W</span>
            </div>
            <LanguageToggle />
          </div>
        </header>

        <WorkoutBuilder
          initialWorkout={activeWorkout}
          ftp={settings.ftp}
          onSave={handleSaveFromBuilder}
          onCancel={() => {
            setCurrentView('library');
            setActiveWorkout(null);
          }}
        />
      </div>
    );
  }

  // MAIN MENU VIEW ('home')
  if (currentView === 'home') {
    return (
      <div className="app-container">
        {renderTopHeader(false)}

        <main className="home-hero-container">
          <div className="home-hero-header">
            <h1 className="home-hero-title">{t('app.home.title')}</h1>
            <p className="home-hero-subtitle">
              {t('app.home.subtitle')}
            </p>
          </div>

          <div className="home-menu-grid">
            {/* Option 1: Solo Rodar */}
            <div
              className="card home-menu-card home-menu-card-freeride"
              onClick={() => setCurrentView('free_ride')}
            >
              <div>
                <div className="home-card-icon home-card-icon-emerald">
                  <Wind size={32} />
                </div>
                <h2 className="home-card-title">{t('app.home.freeride.title')}</h2>
                <p className="home-card-desc">
                  {t('app.home.freeride.desc')}
                </p>
              </div>

              <button
                type="button"
                className="btn btn-emerald btn-lg home-card-cta"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentView('free_ride');
                }}
              >
                <Play size={20} fill="currentColor" /> {t('app.home.freeride.cta')}
              </button>
            </div>

            {/* Option 2: Mis Workouts */}
            <div
              className="card home-menu-card home-menu-card-library"
              onClick={() => setCurrentView('library')}
            >
              <div>
                <div className="home-card-icon home-card-icon-cyan">
                  <Layers size={32} />
                </div>
                <h2 className="home-card-title">{t('app.home.library.title')}</h2>
                <p className="home-card-desc">
                  {t('app.home.library.desc', { count: workouts.length })}
                </p>
              </div>

              <button
                type="button"
                className="btn btn-primary btn-lg home-card-cta"
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentView('library');
                }}
              >
                <Activity size={20} /> {t('app.home.library.cta')}
              </button>
            </div>
          </div>
        </main>

        {connectionModalElement}
        {profileModalElement}
      </div>
    );
  }

  // WORKOUT LIBRARY VIEW ('library')
  return (
    <div className="app-container">
      {renderTopHeader(true)}

      {/* Main Library Content */}
      <main className="library-container">
        <div className="library-header">
          <div>
            <h1 className="library-title">{t('app.library.title')}</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>
              {t('app.library.subtitle')}
            </p>
          </div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontWeight: 600 }}>
            {t('app.library.count', { count: workouts.length })}
          </span>
        </div>

        {/* Workouts Grid */}
        <div className="library-grid">
          {workouts.map((workout) => {
            const stats = computeWorkoutStats(workout, settings.ftp);
            const { name: displayName, description: displayDesc } = getLocalizedWorkoutText(workout, t);

            return (
              <div key={workout.id} className="card workout-card">
                <div>
                  <div className="workout-card-header">
                    <h3 className="workout-name">{displayName}</h3>
                  </div>

                  <p className="workout-desc">
                    {displayDesc}
                  </p>

                  {/* Mini Preview Chart */}
                  <div
                    style={{
                      background: '#090d16',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      marginBottom: '12px',
                      border: '1px solid #1e293b',
                    }}
                  >
                    <WorkoutChart
                      workout={workout}
                      ftp={settings.ftp}
                      height={90}
                      interactive={false}
                      showFtpLine={false}
                    />
                  </div>

                  {/* Summary Stats Row */}
                  <div className="workout-stats-pill-row">
                    <div className="stat-pill">
                      <Clock size={12} style={{ color: 'var(--accent-cyan)' }} />
                      <span>{formatTime(stats.totalDurationSec)}</span>
                    </div>
                    <div className="stat-pill">
                      <Zap size={12} style={{ color: 'var(--accent-amber)' }} />
                      <span>{t('app.library.avgWatts', { watts: stats.avgWatts })}</span>
                    </div>
                    <div className="stat-pill">
                      <Flame size={12} style={{ color: '#fb923c' }} />
                      <span>~{stats.estimatedKcal} kcal</span>
                    </div>
                    <div className="stat-pill">
                      <span>{stats.tss} TSS</span>
                    </div>
                    <div className="stat-pill">
                      <span>IF: {stats.intensityFactor.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="workout-card-actions">
                  <button
                    className="btn btn-emerald"
                    style={{ flex: 1, padding: '10px 14px', fontSize: '0.92rem', fontWeight: 700 }}
                    onClick={() => handleStartRide(workout)}
                  >
                    <Play size={16} fill="currentColor" /> {t('app.library.startErg')}
                  </button>

                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={() => handleEditWorkout(workout)}
                    title={t('app.library.editTitle')}
                  >
                    <Edit3 size={15} />
                  </button>

                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={() => handleDuplicateWorkout(workout)}
                    title={t('app.library.duplicateTitle')}
                  >
                    <Copy size={15} />
                  </button>

                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ color: '#f87171' }}
                    onClick={() => handleDeleteWorkout(workout.id)}
                    title={t('app.library.deleteTitle')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {connectionModalElement}
      {profileModalElement}
    </div>
  );
};

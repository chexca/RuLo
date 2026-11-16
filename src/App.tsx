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
} from './types/workout';
import { computeWorkoutStats, formatTime } from './utils/workoutMath';
import { parseWorkoutFileContent } from './utils/workoutImporter';
import { bleTrainer } from './services/bleTrainer';
import { simulatorTrainer } from './services/simulatorTrainer';
import { WorkoutChart } from './components/WorkoutChart';
import { ConnectionModal } from './components/ConnectionModal';
import { WorkoutBuilder } from './components/WorkoutBuilder';
import { WorkoutRidePlayer } from './components/WorkoutRidePlayer';

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

const DEFAULT_SETTINGS: UserSettings = {
  ftp: 240,
  weightKg: 72,
  soundEnabled: true,
  preferredTransport: 'ant',
};

export const App: React.FC = () => {
  // Views: 'library' | 'builder' | 'player'
  const [currentView, setCurrentView] = useState<'library' | 'builder' | 'player'>('library');
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  // Connection Modal & Hardware State
  const [isConnModalOpen, setIsConnModalOpen] = useState(false);
  const [activeTransport, setActiveTransport] = useState<ConnectionTransport>('none');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [deviceName, setDeviceName] = useState<string | undefined>();
  const [stickName, setStickName] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [discoveredAntDevices, setDiscoveredAntDevices] = useState<DiscoveredDevice[]>([]);
  const [discoveredBleDevices, setDiscoveredBleDevices] = useState<{ deviceId: string; deviceName: string }[]>([]);

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
      setSettings(loadedSettings || DEFAULT_SETTINGS);
    };

    initData();
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

    return () => {
      unsubAntState?.();
      unsubAntDevices?.();
      unsubAntTelemetry?.();
      unsubBleList?.();
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
        setErrorMessage(res.error || 'No se pudo iniciar el escaneo ANT+.');
      } else if (res.stickName) {
        setStickName(res.stickName);
      }
    } else {
      setConnectionStatus('error');
      setErrorMessage('La conexión ANT+ USB requiere ejecutarse dentro de la aplicación Electron.');
    }
  }, []);

  const handleConnectAntDevice = useCallback(
    async (deviceId: number) => {
      setErrorMessage(undefined);
      setConnectionStatus('connecting');
      setActiveTransport('ant');

      if (window.electronAPI?.antConnectDevice) {
        const res = await window.electronAPI.antConnectDevice(deviceId);
        if (!res.ok) {
          setConnectionStatus('error');
          setErrorMessage(res.error || 'Fallo al conectar con el dispositivo ANT+.');
        } else {
          setConnectionStatus('connected');
          setDeviceName(deviceId === 0 ? 'Tacx Neo 2 (Auto)' : `Tacx Neo 2 (#${deviceId})`);
          handleUpdateSettings({ lastAntDeviceId: deviceId, preferredTransport: 'ant' });
        }
      } else {
        setConnectionStatus('error');
        setErrorMessage('La conexión ANT+ USB requiere ejecutarse dentro de Electron.');
      }
    },
    [handleUpdateSettings]
  );

  // Connect Bluetooth
  const handleConnectBle = useCallback(async () => {
    setErrorMessage(undefined);
    setConnectionStatus('connecting');
    setActiveTransport('ble');

    try {
      await bleTrainer.connect(
        (t) => setTelemetry(t),
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
      setErrorMessage((err as Error).message || 'Error de conexión Bluetooth.');
    }
  }, [handleUpdateSettings]);

  const handleSelectBleDevice = useCallback((deviceId: string) => {
    if (window.electronAPI?.selectBluetoothDevice) {
      window.electronAPI.selectBluetoothDevice(deviceId);
    }
  }, []);

  // Connect Simulator
  const handleConnectSimulator = useCallback(() => {
    // If another trainer was active, disconnect it first
    handleDisconnectActiveTrainer();

    setActiveTransport('simulator');
    setConnectionStatus('connected');
    setDeviceName('Rodillo Simulado');

    simulatorTrainer.connect(
      (t: TrainerTelemetry) => setTelemetry(t),
      (s: TrainerStateEvent) => {
        setActiveTransport(s.transport);
        setConnectionStatus(s.status);
        if (s.deviceName) setDeviceName(s.deviceName);
      }
    );
    handleUpdateSettings({ preferredTransport: 'simulator' });
  }, [handleDisconnectActiveTrainer, handleUpdateSettings]);

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
      name: `${workout.name} (copia)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    handleSaveWorkoutsList([clone, ...workouts]);
  };

  const handleDeleteWorkout = (workoutId: string) => {
    if (confirm('¿Seguro que deseas eliminar este entrenamiento?')) {
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
      alert(`Algunos archivos no pudieron importarse:\n${errors.join('\n')}`);
    }
    e.target.value = '';
  };

  // Render view
  if (currentView === 'player' && activeWorkout) {
    return (
      <>
        <WorkoutRidePlayer
          workout={activeWorkout}
          ftp={settings.ftp}
          soundEnabled={settings.soundEnabled}
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
        />
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
        />
      </>
    );
  }

  if (currentView === 'builder') {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="brand-section">
            <div className="brand-logo">
              <Zap size={22} fill="currentColor" />
            </div>
            <div className="brand-title">
              RULO ERG <span className="brand-badge">Tacx Neo 2</span>
            </div>
          </div>
          <div className="ftp-badge-pill">
            <span style={{ color: 'var(--text-muted)' }}>FTP:</span>
            <input
              type="number"
              className="ftp-input"
              value={settings.ftp}
              onChange={(e) => handleUpdateSettings({ ftp: Math.max(50, parseInt(e.target.value) || 200) })}
            />
            <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>W</span>
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

  // DEFAULT VIEW: WORKOUT LIBRARY
  return (
    <div className="app-container">
      {/* Top Application Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">
            <Zap size={22} fill="currentColor" />
          </div>
          <div className="brand-title">
            RULO ERG <span className="brand-badge">Tacx Neo 2 Edition</span>
          </div>
        </div>

        <div className="header-actions">
          {/* Quick inline FTP Editor */}
          <div className="ftp-badge-pill" title="Tu Potencia Umbral Funcional (FTP) para escalar los entrenamientos">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>FTP:</span>
            <input
              type="number"
              className="ftp-input"
              value={settings.ftp}
              onChange={(e) =>
                handleUpdateSettings({ ftp: Math.max(50, parseInt(e.target.value) || 200) })
              }
            />
            <span style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: '0.85rem' }}>W</span>
          </div>

          {/* Sound Toggle */}
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => handleUpdateSettings({ soundEnabled: !settings.soundEnabled })}
            title={settings.soundEnabled ? 'Avisos sonoros habilitados' : 'Avisos sonoros silenciados'}
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
            title="Abrir panel de conexión del rodillo Tacx Neo 2"
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
                : 'Conectar Rodillo'}
            </span>
          </div>

          {/* Import Workout Button */}
          <label
            htmlFor="library-import-input"
            className="btn btn-secondary"
            style={{ cursor: 'pointer' }}
            title="Importar archivos .ZWO, .MRC, .ERG o .JSON"
          >
            <Upload size={16} /> Importar
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
            <Plus size={16} /> Crear Nueva Sesión
          </button>
        </div>
      </header>

      {/* Main Library Content */}
      <main className="library-container">
        <div className="library-header">
          <div>
            <h1 className="library-title">Sesiones Estructuradas en ERG</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>
              Entrenamientos controlados automáticamente por vatios en tu Tacx Neo 2 sin fricción ni bloatware.
            </p>
          </div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontWeight: 600 }}>
            {workouts.length} entrenamientos disponibles
          </span>
        </div>

        {/* Workouts Grid */}
        <div className="library-grid">
          {workouts.map((workout) => {
            const stats = computeWorkoutStats(workout, settings.ftp);

            return (
              <div key={workout.id} className="card workout-card">
                <div>
                  <div className="workout-card-header">
                    <h3 className="workout-name">{workout.name}</h3>
                  </div>

                  <p className="workout-desc">
                    {workout.description || 'Entrenamiento estructurado en modo ERG.'}
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
                      <span>{stats.avgWatts} W med</span>
                    </div>
                    <div className="stat-pill">
                      <Flame size={12} style={{ color: 'var(--accent-rose)' }} />
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
                    <Play size={16} fill="currentColor" /> Entrenar en ERG
                  </button>

                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={() => handleEditWorkout(workout)}
                    title="Editar entrenamiento"
                  >
                    <Edit3 size={15} />
                  </button>

                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={() => handleDuplicateWorkout(workout)}
                    title="Duplicar entrenamiento"
                  >
                    <Copy size={15} />
                  </button>

                  <button
                    className="btn btn-ghost btn-icon"
                    style={{ color: '#f87171' }}
                    onClick={() => handleDeleteWorkout(workout.id)}
                    title="Eliminar de la biblioteca"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Hardware Connection Modal */}
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
      />
    </div>
  );
};

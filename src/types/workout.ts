export type PowerUnit = 'watts' | 'ftp_percent';
export type BlockType = 'steady' | 'ramp';
export type SessionFieldMode = 'visible' | 'blur' | 'hidden';
export type SessionFieldKey =
  | 'power'
  | 'blockTimer'
  | 'sessionTimer'
  | 'cadence'
  | 'speedDistance'
  | 'heartRate'
  | 'energy'
  | 'chart';

export interface WorkoutBlock {
  id: string;
  label?: string;
  type: BlockType;
  /** Duration in seconds */
  durationSec: number;
  /** How the user authored the power values */
  unit: PowerUnit;
  /** For 'steady': target value (Watts or % FTP). For 'ramp': starting value */
  powerStart: number;
  /** For 'ramp': ending value (Watts or % FTP). Ignored or equal to powerStart for 'steady' */
  powerEnd: number;
  /** Optional target cadence hint (RPM) */
  cadenceTarget?: number;
}

export interface Workout {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  blocks: WorkoutBlock[];
}

export interface UserSettings {
  ftp: number;
  weightKg: number;
  maxHr: number;
  restingHr: number;
  age?: number;
  soundEnabled: boolean;
  preferredTransport: 'ant' | 'ble' | 'simulator';
  lastAntDeviceId?: number;
  lastAntHrDeviceId?: number;
  sessionFieldModes?: Record<string, SessionFieldMode>;
}

export type ConnectionTransport = 'ant' | 'ble' | 'simulator' | 'none';
export type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface DiscoveredDevice {
  id: string;
  name: string;
  transport: 'ant' | 'ble';
  antDeviceId?: number;
  rssi?: number;
}

export interface TrainerTelemetry {
  timestamp: number;
  powerWatts: number;
  targetWatts: number;
  cadenceRpm: number;
  speedKmh: number;
  heartRateBpm?: number;
  distanceMeters?: number;
}

export interface RecordedSample {
  timestampMs: number;
  elapsedSec: number;
  powerWatts: number;
  targetWatts: number;
  cadenceRpm: number;
  speedKmh: number;
  distanceMeters: number;
  heartRateBpm?: number;
}

export interface TrainerStateEvent {
  transport: ConnectionTransport;
  status: ConnectionStatus;
  deviceName?: string;
  antStickType?: string;
  errorMessage?: string;
}

export interface HrSensorStateEvent {
  status: ConnectionStatus;
  deviceName?: string;
  deviceId?: number;
  heartRateBpm?: number;
  batteryStatus?: string;
  errorMessage?: string;
}

export interface ElectronAPI {
  // Persistence: Workouts & Settings
  loadData: () => Promise<{ workouts: Workout[]; settings: UserSettings }>;
  saveWorkouts: (workouts: Workout[]) => Promise<boolean>;
  saveSettings: (settings: UserSettings) => Promise<boolean>;
  exportActivityFile: (options: {
    defaultFileName: string;
    tcxContent: string;
    fitBase64?: string;
  }) => Promise<{ canceled: boolean; filePath?: string; error?: string }>;

  // ANT+ USB Stick control (Main process)
  antStartScan: () => Promise<{ ok: boolean; stickName?: string; error?: string }>;
  antStopScan: () => Promise<void>;
  antConnectDevice: (antDeviceId: number) => Promise<{ ok: boolean; error?: string }>;
  antDisconnect: () => Promise<void>;
  antSetTargetPower: (watts: number) => Promise<{ ok: boolean; error?: string }>;

  // ANT+ Heart Rate Strap control (Channel 1 parallel on same ANT+ stick)
  antConnectHr: (hrDeviceId?: number) => Promise<{ ok: boolean; error?: string }>;
  antDisconnectHr: () => Promise<void>;

  // Event subscriptions from Main process (ANT+ & Web Bluetooth picker)
  onAntState: (cb: (state: TrainerStateEvent) => void) => () => void;
  onAntDevices: (cb: (devices: DiscoveredDevice[]) => void) => () => void;
  onAntTelemetry: (cb: (telemetry: TrainerTelemetry) => void) => () => void;
  onAntHrState: (cb: (state: HrSensorStateEvent) => void) => () => void;

  // Electron Web Bluetooth device chooser bridge
  onBluetoothDeviceList: (cb: (devices: { deviceId: string; deviceName: string }[]) => void) => () => void;
  selectBluetoothDevice: (deviceId: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

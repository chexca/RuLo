import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { Workout, UserSettings } from './storage';
import type {
  TrainerStateEvent,
  DiscoveredDevice,
  TrainerTelemetry,
  HrSensorStateEvent,
} from './antManager';
import type {
  GarminStatus,
  GarminLoginResult,
  GarminUploadOptions,
  GarminUploadResult,
} from './garminConnect';
import type {
  StravaStatus,
  StravaLoginResult,
  StravaUploadOptions,
  StravaUploadResult,
} from './stravaConnect';

export interface MiniHudData {
  mode: 'workout' | 'freeride';
  lang: 'es' | 'en';
  isPlaying: boolean;
  isFinished?: boolean;
  powerWatts: number;
  targetWatts: number | null;
  ergEnabled: boolean;
  zoneCode?: string;
  zoneColor?: string;
  zoneName?: string;
  heartRateBpm?: number;
  cadenceRpm?: number;
  elapsedSec: number;
  remainingSec?: number;
  blockName?: string;
  hideClock: boolean;
  resistancePct?: number;
}

export type MiniHudCommand =
  | { type: 'wattsDelta'; delta: number }
  | { type: 'togglePause' }
  | { type: 'close' };

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
  antSetBasicResistance: (percent: number) => Promise<{ ok: boolean; error?: string }>;

  // ANT+ Heart Rate Strap control (Channel 1 parallel on same ANT+ stick)
  antConnectHr: (hrDeviceId?: number) => Promise<{ ok: boolean; error?: string }>;
  antDisconnectHr: () => Promise<void>;

  // Event subscriptions from Main process (ANT+ & Web Bluetooth picker)
  onAntState: (cb: (state: TrainerStateEvent) => void) => () => void;
  onAntDevices: (cb: (devices: DiscoveredDevice[]) => void) => () => void;
  onAntTelemetry: (cb: (telemetry: TrainerTelemetry) => void) => () => void;
  onAntHrState: (cb: (state: HrSensorStateEvent) => void) => () => void;

  // Electron Web Bluetooth device chooser bridge
  onBluetoothDeviceList: (
    cb: (devices: { deviceId: string; deviceName: string }[]) => void
  ) => () => void;
  selectBluetoothDevice: (deviceId: string) => void;

  // Direct Garmin Connect integration (Main process persistent session)
  garminGetStatus: () => Promise<GarminStatus>;
  garminLogin: () => Promise<GarminLoginResult>;
  garminLogout: () => Promise<void>;
  garminUploadActivity: (options: GarminUploadOptions) => Promise<GarminUploadResult>;
  openExternalUrl: (url: string) => Promise<void>;

  // Floating Always-On-Top Mini-HUD
  openMiniHud: () => Promise<boolean>;
  closeMiniHud: () => Promise<void>;
  updateMiniHud: (data: MiniHudData) => void;
  onMiniHudData: (cb: (data: MiniHudData) => void) => () => void;
  sendMiniHudCommand: (cmd: MiniHudCommand) => void;
  onMiniHudCommand: (cb: (cmd: MiniHudCommand) => void) => () => void;
  onMiniHudClosed: (cb: () => void) => () => void;

  // Direct Strava integration (Main process persistent session)
  stravaGetStatus: () => Promise<StravaStatus>;
  stravaLogin: () => Promise<StravaLoginResult>;
  stravaLogout: () => Promise<void>;
  stravaUploadActivity: (options: StravaUploadOptions) => Promise<StravaUploadResult>;
  openExternalStravaUrl: (url: string) => Promise<void>;
}

const api: ElectronAPI = {
  // Persistence
  loadData: () => ipcRenderer.invoke('storage:load-data'),
  saveWorkouts: (workouts: Workout[]) =>
    ipcRenderer.invoke('storage:save-workouts', workouts),
  saveSettings: (settings: UserSettings) =>
    ipcRenderer.invoke('storage:save-settings', settings),
  exportActivityFile: (options) =>
    ipcRenderer.invoke('storage:export-activity', options),

  // ANT+ Trainer Stick Control
  antStartScan: () => ipcRenderer.invoke('ant:start-scan'),
  antStopScan: () => ipcRenderer.invoke('ant:stop-scan'),
  antConnectDevice: (antDeviceId: number) =>
    ipcRenderer.invoke('ant:connect-device', antDeviceId),
  antDisconnect: () => ipcRenderer.invoke('ant:disconnect'),
  antSetTargetPower: (watts: number) =>
    ipcRenderer.invoke('ant:set-target-power', watts),
  antSetBasicResistance: (percent: number) =>
    ipcRenderer.invoke('ant:set-basic-resistance', percent),

  // ANT+ Heart Rate Strap Control
  antConnectHr: (hrDeviceId?: number) =>
    ipcRenderer.invoke('ant:connect-hr', hrDeviceId),
  antDisconnectHr: () => ipcRenderer.invoke('ant:disconnect-hr'),

  // Subscriptions with cleanup functions returning () => void
  onAntState: (cb: (state: TrainerStateEvent) => void) => {
    const listener = (_event: IpcRendererEvent, state: TrainerStateEvent) => cb(state);
    ipcRenderer.on('ant:state', listener);
    return () => {
      ipcRenderer.removeListener('ant:state', listener);
    };
  },

  onAntDevices: (cb: (devices: DiscoveredDevice[]) => void) => {
    const listener = (_event: IpcRendererEvent, devices: DiscoveredDevice[]) => cb(devices);
    ipcRenderer.on('ant:devices', listener);
    return () => {
      ipcRenderer.removeListener('ant:devices', listener);
    };
  },

  onAntTelemetry: (cb: (telemetry: TrainerTelemetry) => void) => {
    const listener = (_event: IpcRendererEvent, telemetry: TrainerTelemetry) => cb(telemetry);
    ipcRenderer.on('ant:telemetry', listener);
    return () => {
      ipcRenderer.removeListener('ant:telemetry', listener);
    };
  },

  onAntHrState: (cb: (state: HrSensorStateEvent) => void) => {
    const listener = (_event: IpcRendererEvent, state: HrSensorStateEvent) => cb(state);
    ipcRenderer.on('ant:hr-state', listener);
    return () => {
      ipcRenderer.removeListener('ant:hr-state', listener);
    };
  },

  onBluetoothDeviceList: (
    cb: (devices: { deviceId: string; deviceName: string }[]) => void
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      devices: { deviceId: string; deviceName: string }[]
    ) => cb(devices);
    ipcRenderer.on('bluetooth-device-list', listener);
    return () => {
      ipcRenderer.removeListener('bluetooth-device-list', listener);
    };
  },

  selectBluetoothDevice: (deviceId: string) => {
    ipcRenderer.send('user-selected-bluetooth-device', deviceId);
  },

  // Direct Garmin Connect integration
  garminGetStatus: () => ipcRenderer.invoke('garmin:get-status'),
  garminLogin: () => ipcRenderer.invoke('garmin:login'),
  garminLogout: () => ipcRenderer.invoke('garmin:logout'),
  garminUploadActivity: (options: GarminUploadOptions) =>
    ipcRenderer.invoke('garmin:upload-activity', options),
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('garmin:open-external-url', url),

  // Floating Always-On-Top Mini-HUD
  openMiniHud: () => ipcRenderer.invoke('mini-hud:open'),
  closeMiniHud: () => ipcRenderer.invoke('mini-hud:close'),
  updateMiniHud: (data: MiniHudData) => {
    ipcRenderer.send('mini-hud:update-data', data);
  },
  onMiniHudData: (cb: (data: MiniHudData) => void) => {
    const listener = (_event: IpcRendererEvent, data: MiniHudData) => cb(data);
    ipcRenderer.on('mini-hud:data', listener);
    return () => {
      ipcRenderer.removeListener('mini-hud:data', listener);
    };
  },
  sendMiniHudCommand: (cmd: MiniHudCommand) => {
    ipcRenderer.send('mini-hud:command', cmd);
  },
  onMiniHudCommand: (cb: (cmd: MiniHudCommand) => void) => {
    const listener = (_event: IpcRendererEvent, cmd: MiniHudCommand) => cb(cmd);
    ipcRenderer.on('mini-hud:command', listener);
    return () => {
      ipcRenderer.removeListener('mini-hud:command', listener);
    };
  },
  onMiniHudClosed: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('mini-hud:closed', listener);
    return () => {
      ipcRenderer.removeListener('mini-hud:closed', listener);
    };
  },

  // Direct Strava integration
  stravaGetStatus: () => ipcRenderer.invoke('strava:get-status'),
  stravaLogin: () => ipcRenderer.invoke('strava:login'),
  stravaLogout: () => ipcRenderer.invoke('strava:logout'),
  stravaUploadActivity: (options: StravaUploadOptions) =>
    ipcRenderer.invoke('strava:upload-activity', options),
  openExternalStravaUrl: (url: string) =>
    ipcRenderer.invoke('strava:open-external-url', url),
};

contextBridge.exposeInMainWorld('electronAPI', api);

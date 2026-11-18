import { app, BrowserWindow, ipcMain, powerSaveBlocker } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  loadData,
  saveWorkouts,
  saveSettings,
  exportActivityFile,
  type Workout,
  type UserSettings,
} from './storage';
import * as antManager from './antManager';
import {
  garminGetStatus,
  garminLogin,
  garminLogout,
  garminUploadActivity,
  openExternalGarminUrl,
  type GarminUploadOptions,
} from './garminConnect';
import {
  stravaGetStatus,
  stravaLogin,
  stravaLogout,
  stravaUploadActivity,
  openExternalStravaUrl,
  type StravaUploadOptions,
} from './stravaConnect';

// Append Chromium feature switches before app is ready for Web Bluetooth support
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-web-bluetooth');

let mainWindow: BrowserWindow | null = null;
let btCallback: ((deviceId: string) => void) | null = null;
let powerSaveBlockerId: number | null = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Prevent display sleep during workouts
    try {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    } catch (e) {
      console.warn('[Main] Failed to start powerSaveBlocker:', e);
    }

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

function createMainWindow(): BrowserWindow {
  const iconPath = path.join(__dirname, '../build/icon.ico');
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 660,
    backgroundColor: '#090d16',
    autoHideMenuBar: true,
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;

  // Web Bluetooth device chooser bridge
  win.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    btCallback = callback;
    if (win && !win.isDestroyed()) {
      win.webContents.send('bluetooth-device-list', deviceList);
    }
  });

  win.webContents.session.setBluetoothPairingHandler((_details, callback) => {
    callback({ confirmed: true });
  });

  // Load application URL / file
  const distIndexPath = path.join(__dirname, '../dist/index.html');
  const devUrl =
    process.env.ELECTRON_RENDERER_URL ||
    process.env.VITE_DEV_SERVER_URL ||
    'http://localhost:5173';

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else if (!app.isPackaged && !fs.existsSync(distIndexPath)) {
    win.loadURL(devUrl);
  } else if (fs.existsSync(distIndexPath)) {
    win.loadFile(distIndexPath);
  } else {
    win.loadURL(devUrl);
  }

  win.on('closed', () => {
    mainWindow = null;
    btCallback = null;
  });

  return win;
}

// -----------------------------------------------------------------------------
// IPC Routes: Storage
// -----------------------------------------------------------------------------
ipcMain.handle('storage:load-data', async () => {
  return loadData();
});

ipcMain.handle('storage:save-workouts', async (_event, workouts: Workout[]) => {
  return saveWorkouts(workouts);
});

ipcMain.handle('storage:save-settings', async (_event, settings: UserSettings) => {
  return saveSettings(settings);
});

ipcMain.handle(
  'storage:export-activity',
  async (
    _event,
    options: {
      defaultFileName: string;
      tcxContent: string;
      fitBase64?: string;
    }
  ) => {
    return exportActivityFile(mainWindow, options);
  }
);

// -----------------------------------------------------------------------------
// IPC Routes: ANT+ Trainer Control
// -----------------------------------------------------------------------------
ipcMain.handle('ant:start-scan', async () => {
  return antManager.startScan();
});

ipcMain.handle('ant:stop-scan', async () => {
  return antManager.stopScan();
});

ipcMain.handle('ant:connect-device', async (_event, antDeviceId: number) => {
  return antManager.connectDevice(antDeviceId);
});

ipcMain.handle('ant:disconnect', async () => {
  return antManager.disconnect();
});

ipcMain.handle('ant:set-target-power', async (_event, watts: number) => {
  return antManager.setTargetPower(watts);
});

ipcMain.handle('ant:set-basic-resistance', async (_event, percent: number) => {
  return antManager.setBasicResistance(percent);
});

// -----------------------------------------------------------------------------
// IPC Routes: ANT+ Heart Rate Strap Control (Channel 1)
// -----------------------------------------------------------------------------
ipcMain.handle('ant:connect-hr', async (_event, hrDeviceId?: number) => {
  return antManager.connectHr(hrDeviceId ?? 0);
});

ipcMain.handle('ant:disconnect-hr', async () => {
  return antManager.disconnectHr();
});

// -----------------------------------------------------------------------------
// IPC Routes: Direct Garmin Connect Integration
// -----------------------------------------------------------------------------
ipcMain.handle('garmin:get-status', async () => {
  return garminGetStatus();
});

ipcMain.handle('garmin:login', async () => {
  return garminLogin(mainWindow);
});

ipcMain.handle('garmin:logout', async () => {
  return garminLogout();
});

ipcMain.handle(
  'garmin:upload-activity',
  async (_event, options: GarminUploadOptions) => {
    return garminUploadActivity(options);
  }
);

ipcMain.handle('garmin:open-external-url', async (_event, url: string) => {
  return openExternalGarminUrl(url);
});

// -----------------------------------------------------------------------------
// IPC Routes: Direct Strava Integration
// -----------------------------------------------------------------------------
ipcMain.handle('strava:get-status', async () => {
  return stravaGetStatus();
});

ipcMain.handle('strava:login', async () => {
  return stravaLogin(mainWindow);
});

ipcMain.handle('strava:logout', async () => {
  return stravaLogout();
});

ipcMain.handle(
  'strava:upload-activity',
  async (_event, options: StravaUploadOptions) => {
    return stravaUploadActivity(options);
  }
);

ipcMain.handle('strava:open-external-url', async (_event, url: string) => {
  return openExternalStravaUrl(url);
});

// Bluetooth device selection from renderer UI
ipcMain.on('user-selected-bluetooth-device', (_event, deviceId: string) => {
  if (btCallback) {
    const cb = btCallback;
    btCallback = null;
    cb(deviceId || '');
  }
});

// -----------------------------------------------------------------------------
// Forward ANT+ Events to Renderer Window
// -----------------------------------------------------------------------------
antManager.onAntState((state) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ant:state', state);
  }
});

antManager.onAntDevices((devices) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ant:devices', devices);
  }
});

antManager.onAntTelemetry((telemetry) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ant:telemetry', telemetry);
  }
});

antManager.onAntHrState((state) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ant:hr-state', state);
  }
});

// -----------------------------------------------------------------------------
// App Lifecycle
// -----------------------------------------------------------------------------
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    try {
      powerSaveBlocker.stop(powerSaveBlockerId);
    } catch {}
    powerSaveBlockerId = null;
  }

  try {
    await antManager.disconnectHr();
  } catch (e) {
    console.error('[Main] Error disconnecting ANT HR on quit:', e);
  }

  try {
    await antManager.disconnect();
  } catch (e) {
    console.error('[Main] Error disconnecting ANT on quit:', e);
  }
});

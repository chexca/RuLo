import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen } from 'electron';
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

// Append Chromium feature switches before app is ready for Web Bluetooth support
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-web-bluetooth');

let mainWindow: BrowserWindow | null = null;
let miniHudWindow: BrowserWindow | null = null;
let latestMiniHudData: unknown = null;
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

  // Keep workout timers and Mini-HUD telemetry ticking even when covered by other windows
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');

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
      backgroundThrottling: false,
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
    closeMiniHudWindow();
  });

  return win;
}

function closeMiniHudWindow(): void {
  if (miniHudWindow && !miniHudWindow.isDestroyed()) {
    miniHudWindow.close();
  }
  miniHudWindow = null;
}

function createMiniHudWindow(): BrowserWindow {
  if (miniHudWindow && !miniHudWindow.isDestroyed()) {
    miniHudWindow.showInactive();
    return miniHudWindow;
  }

  const hudWidth = 492;
  const hudHeight = 112;
  const workArea = screen.getPrimaryDisplay().workArea;
  const x = Math.round(workArea.x + (workArea.width - hudWidth) / 2);
  const y = Math.round(workArea.y + workArea.height - hudHeight - 24);

  const hud = new BrowserWindow({
    width: hudWidth,
    height: hudHeight,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  miniHudWindow = hud;

  try {
    hud.setAlwaysOnTop(true, 'screen-saver');
    hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    hud.setAlwaysOnTop(true);
  }

  const distIndexPath = path.join(__dirname, '../dist/index.html');
  const devBaseUrl =
    process.env.ELECTRON_RENDERER_URL ||
    process.env.VITE_DEV_SERVER_URL ||
    'http://localhost:5173';

  if (process.env.ELECTRON_RENDERER_URL || (!app.isPackaged && !fs.existsSync(distIndexPath)) || !fs.existsSync(distIndexPath)) {
    const hudUrl = new URL(devBaseUrl);
    hudUrl.searchParams.set('view', 'mini-hud');
    void hud.loadURL(hudUrl.toString());
  } else {
    void hud.loadFile(distIndexPath, { query: { view: 'mini-hud' } });
  }

  hud.once('ready-to-show', () => {
    if (!hud.isDestroyed()) {
      hud.showInactive();
    }
  });

  hud.webContents.once('did-finish-load', () => {
    if (!hud.isDestroyed() && latestMiniHudData !== null) {
      hud.webContents.send('mini-hud:data', latestMiniHudData);
    }
  });

  hud.on('closed', () => {
    if (miniHudWindow === hud) {
      miniHudWindow = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mini-hud:closed');
    }
  });

  return hud;
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
// IPC Routes: Floating Always-On-Top Mini-HUD
// -----------------------------------------------------------------------------
ipcMain.handle('mini-hud:open', async () => {
  createMiniHudWindow();
  return true;
});

ipcMain.handle('mini-hud:close', async () => {
  closeMiniHudWindow();
});

ipcMain.on('mini-hud:update-data', (_event, data) => {
  latestMiniHudData = data;
  if (miniHudWindow && !miniHudWindow.isDestroyed()) {
    miniHudWindow.webContents.send('mini-hud:data', data);
  }
});

ipcMain.on('mini-hud:command', (_event, cmd) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mini-hud:command', cmd);
  }
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

import { app, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type PowerUnit = 'watts' | 'ftp_percent';
export type BlockType = 'steady' | 'ramp';

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
}

const DEFAULT_SETTINGS: UserSettings = {
  ftp: 240,
  weightKg: 75,
  maxHr: 185,
  restingHr: 55,
  age: 35,
  soundEnabled: true,
  preferredTransport: 'ant',
};

const DEFAULT_WORKOUTS: Workout[] = [
  {
    id: 'seed-sweet-spot-3x8m',
    name: 'Sweet Spot 3x8m',
    description:
      'Calentamiento progresivo, 3 intervalos en Sweet Spot (90% FTP) con descansos activos y enfriamiento.',
    createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    blocks: [
      {
        id: 'ss-warmup',
        label: 'Calentamiento',
        type: 'ramp',
        durationSec: 480, // 8 min
        unit: 'ftp_percent',
        powerStart: 45,
        powerEnd: 75,
        cadenceTarget: 85,
      },
      {
        id: 'ss-interval-1',
        label: 'Sweet Spot 1',
        type: 'steady',
        durationSec: 480, // 8 min
        unit: 'ftp_percent',
        powerStart: 90,
        powerEnd: 90,
        cadenceTarget: 90,
      },
      {
        id: 'ss-recovery-1',
        label: 'Recuperación 1',
        type: 'steady',
        durationSec: 240, // 4 min
        unit: 'ftp_percent',
        powerStart: 55,
        powerEnd: 55,
        cadenceTarget: 85,
      },
      {
        id: 'ss-interval-2',
        label: 'Sweet Spot 2',
        type: 'steady',
        durationSec: 480, // 8 min
        unit: 'ftp_percent',
        powerStart: 90,
        powerEnd: 90,
        cadenceTarget: 90,
      },
      {
        id: 'ss-recovery-2',
        label: 'Recuperación 2',
        type: 'steady',
        durationSec: 240, // 4 min
        unit: 'ftp_percent',
        powerStart: 55,
        powerEnd: 55,
        cadenceTarget: 85,
      },
      {
        id: 'ss-interval-3',
        label: 'Sweet Spot 3',
        type: 'steady',
        durationSec: 480, // 8 min
        unit: 'ftp_percent',
        powerStart: 90,
        powerEnd: 90,
        cadenceTarget: 90,
      },
      {
        id: 'ss-cooldown',
        label: 'Enfriamiento',
        type: 'ramp',
        durationSec: 300, // 5 min
        unit: 'ftp_percent',
        powerStart: 65,
        powerEnd: 45,
        cadenceTarget: 80,
      },
    ],
  },
  {
    id: 'seed-vo2max-5x3m',
    name: 'VO2max 5x3m',
    description:
      'Calentamiento amplio, 5 series de 3 minutos en zona VO2max (112% FTP) con 3 minutos de recuperación activa.',
    createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    blocks: [
      {
        id: 'vo2-warmup',
        label: 'Calentamiento',
        type: 'ramp',
        durationSec: 600, // 10 min
        unit: 'ftp_percent',
        powerStart: 50,
        powerEnd: 75,
        cadenceTarget: 90,
      },
      {
        id: 'vo2-rep-1',
        label: 'VO2max 1/5',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 112,
        powerEnd: 112,
        cadenceTarget: 95,
      },
      {
        id: 'vo2-rec-1',
        label: 'Recuperación 1',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 50,
        powerEnd: 50,
        cadenceTarget: 85,
      },
      {
        id: 'vo2-rep-2',
        label: 'VO2max 2/5',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 112,
        powerEnd: 112,
        cadenceTarget: 95,
      },
      {
        id: 'vo2-rec-2',
        label: 'Recuperación 2',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 50,
        powerEnd: 50,
        cadenceTarget: 85,
      },
      {
        id: 'vo2-rep-3',
        label: 'VO2max 3/5',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 112,
        powerEnd: 112,
        cadenceTarget: 95,
      },
      {
        id: 'vo2-rec-3',
        label: 'Recuperación 3',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 50,
        powerEnd: 50,
        cadenceTarget: 85,
      },
      {
        id: 'vo2-rep-4',
        label: 'VO2max 4/5',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 112,
        powerEnd: 112,
        cadenceTarget: 95,
      },
      {
        id: 'vo2-rec-4',
        label: 'Recuperación 4',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 50,
        powerEnd: 50,
        cadenceTarget: 85,
      },
      {
        id: 'vo2-rep-5',
        label: 'VO2max 5/5',
        type: 'steady',
        durationSec: 180, // 3 min
        unit: 'ftp_percent',
        powerStart: 112,
        powerEnd: 112,
        cadenceTarget: 95,
      },
      {
        id: 'vo2-cooldown',
        label: 'Enfriamiento',
        type: 'ramp',
        durationSec: 300, // 5 min
        unit: 'ftp_percent',
        powerStart: 60,
        powerEnd: 40,
        cadenceTarget: 80,
      },
    ],
  },
  {
    id: 'seed-rodaje-z2-aerobico-45m',
    name: 'Rodaje Z2 Aeróbico 45m',
    description:
      'Sesión continua en Zona 2 para construcción de base aeróbica y resistencia cardiovascular.',
    createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    blocks: [
      {
        id: 'z2-warmup',
        label: 'Calentamiento',
        type: 'ramp',
        durationSec: 300, // 5 min
        unit: 'ftp_percent',
        powerStart: 50,
        powerEnd: 68,
        cadenceTarget: 85,
      },
      {
        id: 'z2-steady',
        label: 'Z2 Aeróbico',
        type: 'steady',
        durationSec: 2100, // 35 min
        unit: 'ftp_percent',
        powerStart: 70,
        powerEnd: 70,
        cadenceTarget: 90,
      },
      {
        id: 'z2-cooldown',
        label: 'Enfriamiento',
        type: 'ramp',
        durationSec: 300, // 5 min
        unit: 'ftp_percent',
        powerStart: 68,
        powerEnd: 45,
        cadenceTarget: 80,
      },
    ],
  },
  {
    id: 'seed-escalera-rapida-erg-12m',
    name: 'Escalera Rápida ERG (Test 12m)',
    description:
      'Test escalonado rápido en vatios absolutos para probar calibración y respuesta ERG del rodillo.',
    createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    blocks: [
      {
        id: 'esc-120w',
        label: 'Escalón 120W',
        type: 'steady',
        durationSec: 120, // 2 min
        unit: 'watts',
        powerStart: 120,
        powerEnd: 120,
        cadenceTarget: 85,
      },
      {
        id: 'esc-160w',
        label: 'Escalón 160W',
        type: 'steady',
        durationSec: 120, // 2 min
        unit: 'watts',
        powerStart: 160,
        powerEnd: 160,
        cadenceTarget: 88,
      },
      {
        id: 'esc-200w',
        label: 'Escalón 200W',
        type: 'steady',
        durationSec: 120, // 2 min
        unit: 'watts',
        powerStart: 200,
        powerEnd: 200,
        cadenceTarget: 90,
      },
      {
        id: 'esc-240w',
        label: 'Escalón 240W',
        type: 'steady',
        durationSec: 120, // 2 min
        unit: 'watts',
        powerStart: 240,
        powerEnd: 240,
        cadenceTarget: 92,
      },
      {
        id: 'esc-280w',
        label: 'Escalón 280W',
        type: 'steady',
        durationSec: 120, // 2 min
        unit: 'watts',
        powerStart: 280,
        powerEnd: 280,
        cadenceTarget: 94,
      },
      {
        id: 'esc-cooldown',
        label: 'Rampa Enfriamiento',
        type: 'ramp',
        durationSec: 120, // 2 min
        unit: 'watts',
        powerStart: 180,
        powerEnd: 100,
        cadenceTarget: 80,
      },
    ],
  },
];

function getWorkoutsFilePath(): string {
  return path.join(app.getPath('userData'), 'workouts.json');
}

function getSettingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadWorkouts(): Workout[] {
  const filePath = getWorkoutsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (raw.length > 0) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('[Storage] Error reading workouts.json, seeding defaults:', err);
  }

  // Seed default workouts
  saveWorkouts(DEFAULT_WORKOUTS);
  return DEFAULT_WORKOUTS;
}

export function saveWorkouts(workouts: Workout[]): boolean {
  const filePath = getWorkoutsFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(workouts, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Storage] Error writing workouts.json:', err);
    return false;
  }
}

export function loadSettings(): UserSettings {
  const filePath = getSettingsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (raw.length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            ...DEFAULT_SETTINGS,
            ...parsed,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[Storage] Error reading settings.json, falling back to defaults:', err);
  }

  saveSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: UserSettings): boolean {
  const filePath = getSettingsFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Storage] Error writing settings.json:', err);
    return false;
  }
}

export function loadData(): { workouts: Workout[]; settings: UserSettings } {
  return {
    workouts: loadWorkouts(),
    settings: loadSettings(),
  };
}

export async function exportActivityFile(
  win: BrowserWindow | null,
  options: {
    defaultFileName: string;
    tcxContent: string;
    fitBase64?: string;
  }
): Promise<{ canceled: boolean; filePath?: string; error?: string }> {
  try {
    const dir = path.join(app.getPath('documents'), 'Rulo ERG');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const defaultPath = path.join(dir, options.defaultFileName);
    const result = win
      ? await dialog.showSaveDialog(win, {
          defaultPath,
          filters: [
            { name: 'Garmin TCX (Strava / Garmin)', extensions: ['tcx'] },
            { name: 'Garmin FIT Binario', extensions: ['fit'] },
          ],
        })
      : await dialog.showSaveDialog({
          defaultPath,
          filters: [
            { name: 'Garmin TCX (Strava / Garmin)', extensions: ['tcx'] },
            { name: 'Garmin FIT Binario', extensions: ['fit'] },
          ],
        });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const chosenPath = result.filePath;
    if (chosenPath.toLowerCase().endsWith('.fit') && options.fitBase64) {
      const buffer = Buffer.from(options.fitBase64, 'base64');
      fs.writeFileSync(chosenPath, buffer);
    } else {
      fs.writeFileSync(chosenPath, options.tcxContent, 'utf8');
    }

    return { canceled: false, filePath: chosenPath };
  } catch (err: any) {
    console.error('[Storage] Error exporting activity file:', err);
    return { canceled: false, error: err?.message || 'Error al exportar la actividad' };
  }
}

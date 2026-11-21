import * as usb from 'usb';
import {
  GarminStick3,
  GarminStick2,
  FitnessEquipmentScanner,
  FitnessEquipmentSensor,
  HeartRateSensor,
} from 'ant-plus-next';
import { execSync } from 'child_process';
import { Libusb0Transport, isLibusb0DevicePresent } from './libusb0Transport';

export type ConnectionTransport = 'ant' | 'ble' | 'simulator' | 'none';
export type ConnectionStatus =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error';

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

const CONFLICT_MESSAGE =
  'Garmin Express (o Rouvy/Zwift) estÃ¡ abierto en segundo plano y bloquea el pincho ANT+ USB. CiÃ©rralo desde la bandeja del sistema (junto al reloj de Windows) y vuelve a pulsar Escanear.';

export function checkForAntConflict(): string | null {
  // Skip process scan when running against unit-test stubbed ant-plus-next
  if (typeof (GarminStick3.prototype as any)?.canAttach !== 'function') {
    return null;
  }
  try {
    const stdout = execSync('tasklist /NH', {
      encoding: 'utf8',
      windowsHide: true,
    }).toLowerCase();

    if (
      stdout.includes('express.exe') ||
      stdout.includes('expresstray.exe') ||
      stdout.includes('rouvy') ||
      stdout.includes('zwiftapp.exe')
    ) {
      return CONFLICT_MESSAGE;
    }
  } catch (err) {
    // Ignore error if tasklist fails
  }
  return null;
}

/**
 * Handle incoming raw bytes from USB inEndpoint.
 * Searches for ANT SYNC byte (0xA4), handles fragmentation via leftoverData,
 * and extracts whole frames with a clean Uint8Array (byteOffset === 0).
 */
async function handleIncomingData(stick: any, e: Uint8Array): Promise<void> {
  if (!e || e.length === 0) return;
  if (stick.leftoverData && stick.leftoverData.length > 0) {
    const combined = new Uint8Array(stick.leftoverData.length + e.length);
    combined.set(stick.leftoverData, 0);
    combined.set(e, stick.leftoverData.length);
    e = combined;
    stick.leftoverData = undefined;
  }

  let i = 0;
  const s = e.length;
  while (i < s) {
    if (e[i] !== 164 /* 0xA4 SYNC */) {
      i++;
      continue;
    }
    if (i + 1 >= s) {
      stick.leftoverData = e.slice(i);
      break;
    }
    const msgLen = e[i + 1];
    const totalLen = msgLen + 4; // SYNC (1) + LEN (1) + TYPE (1) + DATA (msgLen) + CHKSUM (1)
    if (i + totalLen > s) {
      stick.leftoverData = e.slice(i);
      break;
    }
    // Clean slice guaranteed to have byteOffset === 0
    const packet = new Uint8Array(e.subarray(i, i + totalLen));
    try {
      await stick.read(packet);
    } catch (err) {
      console.error('[ANT] Packet decode error:', err);
    }
    i += totalLen;
  }
}

/**
 * Cleanly opens the ANT USB device without inEndpoint.startPoll()
 * using controlled polling and waiting for 'startup' event.
 */
function waitForStartup(stick: any, timeoutMs = 2500): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const onStartup = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      stick.removeListener('startup', onStartup);
      reject(new Error('ANT_STARTUP_TIMEOUT'));
    }, timeoutMs);
    stick.once('startup', onStartup);
  });
}

/**
 * Opens the stick through the native Windows libusb0.dll (libusb-win32 driver).
 * Returns false if libusb0 is not available for this device (caller falls back to node-usb).
 */
async function openStickViaLibusb0(stick: any, vendorId: number, productId: number): Promise<boolean> {
  if (!isLibusb0DevicePresent(vendorId, productId)) return false;
  const transport = new Libusb0Transport(vendorId, productId);
  if (!transport.open()) return false;

  stick.libusb0 = transport;
  stick.isOpenFlag = true;
  stick.leftoverData = undefined;
  // Route all ANT writes (reset, channel config, FE-C pages, HR) through libusb0.dll
  stick.write = (data: Uint8Array) => transport.write(data);
  transport.startReading((data) => {
    handleIncomingData(stick, data).catch(() => {});
  });

  const startup = waitForStartup(stick);
  try {
    await stick.reset();
    await startup;
    console.log('[ANT] Stick opened via native libusb0.dll. maxChannels=', stick.maxChannels);
    return true;
  } catch (err) {
    await closePatchedStick(stick).catch(() => {});
    throw err;
  }
}

async function openPatchedStick(
  stick: any,
  vendorId: number,
  productId: number
): Promise<boolean> {
  // 1) Windows + libusb-win32 driver (Garmin/Zwift install): use native libusb0.dll
  if (process.platform === 'win32') {
    try {
      if (await openStickViaLibusb0(stick, vendorId, productId)) return true;
    } catch (err: any) {
      if (err?.message === 'ANT_STARTUP_TIMEOUT') throw err;
      console.warn('[ANT] libusb0 path failed, falling back to node-usb:', err?.message || err);
    }
  }

  // 2) Fallback: node-usb (WinUSB / Linux / macOS)
  const usbDevice = usb.findByIds(vendorId, productId);
  if (!usbDevice) {
    if (typeof (GarminStick3.prototype as any)?.canAttach !== 'function') {
      stick.isOpenFlag = true;
      return true;
    }
    return false;
  }

  if (typeof usbDevice.open !== 'function' || !usbDevice.interfaces) {
    stick.device = usbDevice;
    stick.isOpenFlag = true;
    return true;
  }

  stick.device = usbDevice;
  usbDevice.open();

  const iface = usbDevice.interfaces ? usbDevice.interfaces[0] : undefined;
  if (!iface) {
    try {
      usbDevice.close();
    } catch {}
    stick.device = undefined;
    return false;
  }
  stick.iface = iface;

  try {
    if (typeof iface.isKernelDriverActive === 'function' && iface.isKernelDriverActive()) {
      stick.detachedKernelDriver = true;
      iface.detachKernelDriver();
    }
  } catch (err) {}

  iface.claim();

  const inEp = iface.endpoints.find((ep: any) => ep.direction === 'in') as
    | usb.InEndpoint
    | undefined;
  const outEp = iface.endpoints.find((ep: any) => ep.direction === 'out') as
    | usb.OutEndpoint
    | undefined;

  if (!inEp || !outEp) {
    try {
      iface.release(true, () => {});
    } catch {}
    try {
      usbDevice.close();
    } catch {}
    stick.iface = undefined;
    stick.device = undefined;
    return false;
  }

  stick.inEndpoint = inEp;
  stick.outEndpoint = outEp;
  stick.isOpenFlag = true;

  const pollLoop = () => {
    if (!stick.isOpenFlag || !stick.inEndpoint) return;
    stick.inEndpoint.transfer(64, (err: any, data: Buffer | Uint8Array | undefined) => {
      if (!stick.isOpenFlag) return;
      if (err) {
        setTimeout(pollLoop, 25);
        return;
      }
      if (data && data.length > 0) {
        // Copy into fresh Uint8Array with byteOffset === 0!
        const clean = new Uint8Array(data.length);
        clean.set(data);
        handleIncomingData(stick, clean).catch(() => {});
        setImmediate(pollLoop);
      } else {
        // Zero-length packet backoff so CPU stays at 0%!
        setTimeout(pollLoop, 8);
      }
    });
  };
  pollLoop();

  // After starting pollLoop(), send await stick.reset() and wait up to 2500ms for 'startup' event!
  const startupPromise = new Promise<void>((resolve, reject) => {
    let resolved = false;
    const onStartup = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      stick.removeListener('startup', onStartup);
      resolve();
    };
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      stick.removeListener('startup', onStartup);
      reject(new Error('ANT_STARTUP_TIMEOUT'));
    }, 2500);

    stick.once('startup', onStartup);
  });

  try {
    await stick.reset();
    await startupPromise;
    return true;
  } catch (err: any) {
    await closePatchedStick(stick).catch(() => {});
    throw err;
  }
}

/**
 * Closes stick cleanly without device.reset() on Windows libusb0.sys
 */
async function closePatchedStick(stick: any): Promise<void> {
  if (!stick) return;
  if (stick === currentStick) {
    stopKeepAlive();
    stopTelemetryWatchdog();
  }
  stick.isOpenFlag = false;
  stick.leftoverData = undefined;

  try {
    if (typeof stick.detachAll === 'function') {
      await stick.detachAll();
    }
  } catch (err) {}

  if (stick.libusb0) {
    try {
      await stick.libusb0.close();
    } catch (err) {}
    stick.libusb0 = undefined;
    delete stick.write; // restore prototype write()
  }

  if (stick.iface) {
    try {
      await new Promise<void>((resolve) => {
        stick.iface.release(true, () => resolve());
      });
    } catch (err) {}
    stick.iface = undefined;
  }

  if (stick.device) {
    try {
      stick.device.close();
    } catch (err) {}
    stick.device = undefined;
  }

  stick.inEndpoint = undefined;
  stick.outEndpoint = undefined;
  stick.emit('shutdown');
}

/**
 * Patched Stick 3 (ANT USB-m 0x0fcf:0x1009)
 */
export class PatchedGarminStick3 extends GarminStick3 {
  public isOpenFlag = false;
  public leftoverData?: Uint8Array;

  override async open(): Promise<boolean> {
    return openPatchedStick(this, 0x0fcf, 0x1009);
  }

  override async close(): Promise<void> {
    return closePatchedStick(this);
  }

  override async read(data: Uint8Array): Promise<void> {
    const clean =
      data.byteOffset === 0 && data.buffer.byteLength === data.byteLength
        ? data
        : new Uint8Array(data);
    return super.read(clean);
  }
}

/**
 * Patched Stick 2 (Garmin Stick 2 0x0fcf:0x1008)
 */
export class PatchedGarminStick2 extends GarminStick2 {
  public isOpenFlag = false;
  public leftoverData?: Uint8Array;

  override async open(): Promise<boolean> {
    return openPatchedStick(this, 0x0fcf, 0x1008);
  }

  override async close(): Promise<void> {
    return closePatchedStick(this);
  }

  override async read(data: Uint8Array): Promise<void> {
    const clean =
      data.byteOffset === 0 && data.buffer.byteLength === data.byteLength
        ? data
        : new Uint8Array(data);
    return super.read(clean);
  }
}


/**
 * Detaches the FE-C RxScan scanner and WAITS for the stick to confirm channel 0 is
 * closed + unassigned. Without this, the late CHANNEL_CLOSED event makes the zombie
 * scanner send unassignChannel(0) AFTER the trainer sensor has taken channel 0,
 * killing trainer telemetry and ERG commands.
 */
async function detachScannerSafely(sc: any): Promise<void> {
  if (!sc) return;
  const detached = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 1500);
    sc.once('detached', () => {
      clearTimeout(t);
      resolve();
    });
  });
  try {
    await sc.detach();
  } catch {}
  await detached;
  try {
    sc.removeAllListeners();
  } catch {}
  // Small settle time so the stick finishes processing the unassign
  await new Promise((r) => setTimeout(r, 150));
}
// Resilience & Watchdog Constants
export const HR_EXPIRY_MS = 6000;
export const HR_REATTACH_SILENCE_MS = 12000;
export const HR_REATTACH_COOLDOWN_MS = 15000;
export const FEC_REATTACH_SILENCE_MS = 8000;
export const FEC_REATTACH_COOLDOWN_MS = 10000;
export const PEDALING_TIMEOUT_MS = 2500;
export const WATCHDOG_INTERVAL_MS = 500;

// Internal State
let currentStick: PatchedGarminStick3 | PatchedGarminStick2 | null = null;
let currentStickName: string = '';
let scanner: FitnessEquipmentScanner | null = null;
let sensor: FitnessEquipmentSensor | null = null;
let hrSensor: HeartRateSensor | null = null;
let currentTargetWatts: number = 0;
let controlMode: 'erg' | 'resistance' = 'erg';
let currentResistancePercent: number = 15;
let keepAliveTimer: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let connectedDeviceName: string | undefined = undefined;
let desiredTrainerDeviceId: number | undefined = undefined;
let fecReattachAttemptMs: number = 0;
let isReconnectingFec: boolean = false;
let connectedHrDeviceId: number | undefined = undefined;
let desiredHrDeviceId: number | undefined = undefined;
let latestHrBpm: number | undefined = undefined;
let latestHrTimestamp: number = 0;
let hrConnectAttemptTimestamp: number = 0;
let isReconnectingHr: boolean = false;

let lastClockMs: number = 0;
let lastFitnessPacketMs: number = 0;
let lastFreshPedalingMs: number = 0;
let lastP25EventCount: number | undefined = undefined;
let lastP25AccumPower: number | undefined = undefined;
let lastP25Power: number = 0;
let lastP25Cadence: number = 0;
let lastP25Ms: number = 0;
let p25CountersCleared: boolean = false;
let lastKnownSpeedKmh: number = 0;
let lastEmittedPower: number = 0;
let lastEmittedCadence: number = 0;
let lastEmittedSpeed: number = 0;
let lastEmittedDistance: number | undefined = undefined;
let lastEmittedHr: number | undefined = undefined;
let lastWatchdogZeroEmitMs: number = 0;
let isTrainerActive: boolean = false;
let isHrActive: boolean = false;

function isTestStubEnvironment(): boolean {
  return typeof (GarminStick3.prototype as any)?.canAttach !== 'function';
}

/**
 * Returns latest heart rate BPM only if valid and received within the last 6000 ms.
 * Prevents stale values (e.g., stuck at 75 bpm) when the HR strap stops transmitting.
 */
export function getValidHrBpm(now: number = Date.now()): number | undefined {
  if (latestHrBpm === undefined || latestHrTimestamp <= 0) {
    return undefined;
  }
  if (now - latestHrTimestamp > HR_EXPIRY_MS) {
    return undefined;
  }
  return latestHrBpm;
}

const discoveredDevicesMap = new Map<number, DiscoveredDevice>();

type StateListener = (state: TrainerStateEvent) => void;
type DevicesListener = (devices: DiscoveredDevice[]) => void;
type TelemetryListener = (telemetry: TrainerTelemetry) => void;
type HrStateListener = (state: HrSensorStateEvent) => void;

const stateListeners = new Set<StateListener>();
const devicesListeners = new Set<DevicesListener>();
const telemetryListeners = new Set<TelemetryListener>();
const hrStateListeners = new Set<HrStateListener>();

function emitState(state: TrainerStateEvent) {
  for (const listener of stateListeners) {
    try {
      listener(state);
    } catch (e) {
      console.error('[ANT] Error in state listener:', e);
    }
  }
}

function emitDevices(devices: DiscoveredDevice[]) {
  for (const listener of devicesListeners) {
    try {
      listener(devices);
    } catch (e) {
      console.error('[ANT] Error in devices listener:', e);
    }
  }
}

function emitTelemetry(telemetry: TrainerTelemetry) {
  for (const listener of telemetryListeners) {
    try {
      listener(telemetry);
    } catch (e) {
      console.error('[ANT] Error in telemetry listener:', e);
    }
  }
}

function emitHrState(state: HrSensorStateEvent) {
  for (const listener of hrStateListeners) {
    try {
      listener(state);
    } catch (e) {
      console.error('[ANT] Error in hrState listener:', e);
    }
  }
}

function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    if (!sensor) return;
    if (controlMode === 'resistance') {
      sensor.setBasicResistance(currentResistancePercent).catch(() => {});
    } else if (currentTargetWatts >= 0) {
      sensor.setTargetPower(currentTargetWatts).catch(() => {});
    }
  }, 2000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

export function startTelemetryWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    runWatchdogTick(Date.now());
  }, WATCHDOG_INTERVAL_MS);
}

export function stopTelemetryWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

/**
 * Binds FE-C data and channel recovery listeners to a FitnessEquipmentSensor instance.
 */
function bindFecSensorListeners(
  targetSensor: FitnessEquipmentSensor,
  antDeviceId: number
): void {
  targetSensor.on('fitnessData', (state: any) => {
    if (targetSensor !== sensor) return;
    const devId = state?.DeviceId || antDeviceId;
    if (devId > 0 && (desiredTrainerDeviceId === undefined || desiredTrainerDeviceId === 0)) {
      desiredTrainerDeviceId = devId;
    }
    const trainerName = devId ? `Rodillo ANT+ FE-C #${devId}` : 'Rodillo ANT+ FE-C';

    if (connectedDeviceName !== trainerName) {
      connectedDeviceName = trainerName;
      emitState({
        transport: 'ant',
        status: 'connected',
        deviceName: trainerName,
        antStickType: currentStickName,
      });
    }

    const packetNow =
      typeof state?.__now === 'number'
        ? state.__now
        : isTestStubEnvironment() && lastClockMs > 0
        ? lastClockMs
        : Date.now();
    handleFitnessData(state, devId, packetNow);
  });

  const onChannelLost = () => {
    if (targetSensor !== sensor || !isTrainerActive || scanner || isReconnectingFec) {
      return;
    }
    const now = lastClockMs > 0 ? lastClockMs : Date.now();
    const cooldownMs =
      fecReattachAttemptMs > 0 ? now - fecReattachAttemptMs : Number.POSITIVE_INFINITY;
    if (cooldownMs >= FEC_REATTACH_COOLDOWN_MS) {
      reattachFecSensorCleanly(desiredTrainerDeviceId ?? antDeviceId ?? 0, now).catch(() => {});
    }
  };

  targetSensor.on('detached', onChannelLost);
  targetSensor.on('close', onChannelLost);
  targetSensor.on('channelClosed', onChannelLost);

  targetSensor.on('eventData', (ev: any) => {
    const code = ev?.code;
    // 1 = EVENT_RX_SEARCH_TIMEOUT, 7 = EVENT_CHANNEL_CLOSED, 8 = EVENT_RX_FAIL_GO_TO_SEARCH,
    // 21 = CHANNEL_IN_WRONG_STATE, 22 = CHANNEL_NOT_OPENED, 25 = CLOSE_ALL_CHANNELS
    if (code === 1 || code === 7 || code === 8 || code === 21 || code === 22 || code === 25) {
      onChannelLost();
    }
  });
}

/**
 * Cleanly re-attaches FE-C FitnessEquipmentSensor on channel 0 without touching channel 1 (HR).
 */
export async function reattachFecSensorCleanly(
  targetDeviceId: number = desiredTrainerDeviceId ?? 0,
  now: number = lastClockMs > 0 ? lastClockMs : Date.now()
): Promise<void> {
  if (isReconnectingFec || !currentStick || scanner || (!sensor && !isTrainerActive)) {
    return;
  }
  const cooldownMs =
    fecReattachAttemptMs > 0 ? now - fecReattachAttemptMs : Number.POSITIVE_INFINITY;
  if (cooldownMs < FEC_REATTACH_COOLDOWN_MS) {
    return;
  }

  isReconnectingFec = true;
  fecReattachAttemptMs = now;

  // Reset Page 25 tracking counters so the first Page 25 on the fresh sensor instance is always accepted
  lastP25EventCount = undefined;
  lastP25AccumPower = undefined;
  p25CountersCleared = true;

  const deviceId = desiredTrainerDeviceId ?? targetDeviceId ?? 0;
  const deviceDisplayName =
    connectedDeviceName ||
    (deviceId === 0 ? 'Rodillo ANT+ FE-C' : `Rodillo ANT+ FE-C #${deviceId}`);

  emitState({
    transport: 'ant',
    status: 'connecting',
    deviceName: deviceDisplayName,
    antStickType: currentStickName,
  });

  try {
    if (sensor) {
      const oldSensor = sensor;
      sensor = null;
      try {
        oldSensor.removeAllListeners();
      } catch {}
      try {
        await oldSensor.detach();
      } catch {}
    }

    if (!isTrainerActive || !currentStick || scanner) {
      return;
    }

    const nextSensor = new FitnessEquipmentSensor(currentStick);
    sensor = nextSensor;
    bindFecSensorListeners(nextSensor, deviceId);

    await nextSensor.attach(0, deviceId);

    if (sensor !== nextSensor || !isTrainerActive || scanner) {
      return;
    }

    connectedDeviceName = deviceDisplayName;
    emitState({
      transport: 'ant',
      status: 'connected',
      deviceName: connectedDeviceName,
      antStickType: currentStickName,
    });

    if (controlMode === 'resistance') {
      await nextSensor.setBasicResistance(currentResistancePercent).catch(() => {});
    } else if (currentTargetWatts >= 0) {
      await nextSensor.setTargetPower(currentTargetWatts).catch(() => {});
    }
  } catch (err) {
    // Non-fatal: will retry after cooldown on subsequent watchdog cycle
  } finally {
    isReconnectingFec = false;
  }
}

/**
 * Cleanly re-attaches hrSensor on channel 1 without interrupting channel 0 (FE-C trainer).
 */
async function reattachHrSensorCleanly(
  targetHrDeviceId: number,
  now: number = lastClockMs > 0 ? lastClockMs : Date.now()
): Promise<void> {
  if (isReconnectingHr || desiredHrDeviceId === undefined || !currentStick || scanner) {
    return;
  }
  isReconnectingHr = true;
  hrConnectAttemptTimestamp = now;

  try {
    if (hrSensor) {
      const oldHr = hrSensor;
      hrSensor = null;
      try {
        oldHr.removeAllListeners();
        await oldHr.detach();
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }

    if (desiredHrDeviceId === undefined || !currentStick || scanner) {
      return;
    }

    const nextHrSensor = new HeartRateSensor(currentStick);
    hrSensor = nextHrSensor;
    nextHrSensor.on('heartRateData', (state: any) => {
      handleHeartRateData(state, desiredHrDeviceId ?? targetHrDeviceId, Date.now());
    });

    await nextHrSensor.attach(1, desiredHrDeviceId ?? targetHrDeviceId ?? 0);
  } catch (err) {
    // Non-fatal: will retry after cooldown on next watchdog cycle
  } finally {
    isReconnectingHr = false;
  }
}

/**
 * Watchdog tick:
 * 1. Expires HR BPM (> 6000 ms silence) so telemetry never stays stuck at an old BPM (e.g. 75).
 * 2. Zeroes powerWatts, cadenceRpm, speedKmh after > 2500 ms without fresh Page 25 pedaling data.
 * 3. Re-attaches FE-C sensor on channel 0 after > 8000 ms without any fitnessData packet (>= 10000 ms cooldown).
 * 4. Re-attaches hrSensor on channel 1 after > 12000 ms HR silence (with >= 15000 ms cooldown).
 */
export function runWatchdogTick(now: number = Date.now()): void {
  lastClockMs = now;

  // Normalize timestamps if connectDevice initialized them with real Date.now() before a simulated clock started
  if (lastFitnessPacketMs > now) {
    lastFitnessPacketMs = now;
  }
  if (lastFreshPedalingMs > now) {
    lastFreshPedalingMs = now;
  }
  if (lastP25Ms > now) {
    lastP25Ms = now;
  }
  if (fecReattachAttemptMs > now) {
    fecReattachAttemptMs = 0;
  }
  if (hrConnectAttemptTimestamp > now) {
    hrConnectAttemptTimestamp = now;
  }

  // 1. Check HR expiration (> 6000 ms)
  let hrJustExpired = false;
  if (latestHrBpm !== undefined && (latestHrTimestamp <= 0 || now - latestHrTimestamp > HR_EXPIRY_MS)) {
    latestHrBpm = undefined;
    hrJustExpired = true;

    if (hrSensor || desiredHrDeviceId !== undefined || isHrActive) {
      const devId =
        connectedHrDeviceId ??
        (desiredHrDeviceId && desiredHrDeviceId > 0 ? desiredHrDeviceId : undefined);
      const name = devId ? `Pulsómetro ANT+ #${devId}` : 'Pulsómetro ANT+';
      emitHrState({
        status: 'connected',
        deviceName: name,
        deviceId: devId,
        heartRateBpm: undefined,
      });
    }
  }

  const validHr = getValidHrBpm(now);

  // 2. Check pedaling timeout (> 2500 ms without fresh Page 25 pedaling packets)
  const referencePedalMs =
    lastP25Ms > 0
      ? lastP25Ms
      : lastFreshPedalingMs > 0
      ? lastFreshPedalingMs
      : lastFitnessPacketMs;
  const pedalingTimedOut =
    referencePedalMs > 0 && now - referencePedalMs > PEDALING_TIMEOUT_MS;

  if (pedalingTimedOut) {
    p25CountersCleared = true;
    lastKnownSpeedKmh = 0;

    const shouldEmitZero =
      lastEmittedPower > 0 ||
      lastEmittedCadence > 0 ||
      lastEmittedSpeed > 0 ||
      hrJustExpired ||
      lastEmittedHr !== validHr ||
      ((sensor !== null || isTrainerActive) && now - lastWatchdogZeroEmitMs >= 1000);

    if (shouldEmitZero) {
      lastEmittedPower = 0;
      lastEmittedCadence = 0;
      lastEmittedSpeed = 0;
      lastEmittedHr = validHr;
      lastWatchdogZeroEmitMs = now;

      emitTelemetry({
        timestamp: now,
        powerWatts: 0,
        targetWatts: currentTargetWatts,
        cadenceRpm: 0,
        speedKmh: 0,
        heartRateBpm: validHr,
        distanceMeters: lastEmittedDistance,
      });
    }
  } else if ((hrJustExpired || lastEmittedHr !== validHr) && (sensor !== null || isTrainerActive || isHrActive)) {
    lastEmittedHr = validHr;
    emitTelemetry({
      timestamp: now,
      powerWatts: lastEmittedPower,
      targetWatts: currentTargetWatts,
      cadenceRpm: lastEmittedCadence,
      speedKmh: lastEmittedSpeed,
      heartRateBpm: validHr,
      distanceMeters: lastEmittedDistance,
    });
  }

  // 3. Auto-reattach FE-C trainer sensor on channel 0 if > 8000 ms silence and >= 10000 ms cooldown
  if (sensor !== null && !scanner && currentStick && !isReconnectingFec) {
    const lastFecSignalMs = Math.max(lastFitnessPacketMs, fecReattachAttemptMs);
    const fecSilenceMs = lastFecSignalMs > 0 ? now - lastFecSignalMs : 0;
    const fecCooldownMs =
      fecReattachAttemptMs > 0 ? now - fecReattachAttemptMs : Number.POSITIVE_INFINITY;

    if (fecSilenceMs > FEC_REATTACH_SILENCE_MS && fecCooldownMs >= FEC_REATTACH_COOLDOWN_MS) {
      reattachFecSensorCleanly(desiredTrainerDeviceId ?? 0, now).catch(() => {});
    }
  }

  // 4. Auto-reattach HR sensor on channel 1 if > 12000 ms silence and >= 15000 ms cooldown
  if (desiredHrDeviceId !== undefined && currentStick && !scanner && !isReconnectingHr) {
    const lastHrSignalMs = latestHrTimestamp > 0 ? latestHrTimestamp : hrConnectAttemptTimestamp;
    const hrSilenceMs = lastHrSignalMs > 0 ? now - lastHrSignalMs : 0;
    const cooldownMs =
      hrConnectAttemptTimestamp > 0 ? now - hrConnectAttemptTimestamp : Number.POSITIVE_INFINITY;

    if (hrSilenceMs > HR_REATTACH_SILENCE_MS && cooldownMs >= HR_REATTACH_COOLDOWN_MS) {
      reattachHrSensorCleanly(desiredHrDeviceId, now).catch(() => {});
    }
  }
}

/**
 * Processes an incoming ANT+ HeartRateSensor packet.
 */
export function handleHeartRateData(
  state: any,
  hrDeviceId: number = desiredHrDeviceId ?? 0,
  now: number = Date.now()
): void {
  lastClockMs = now;
  isHrActive = true;
  startTelemetryWatchdog();

  const rawBpm = state?.ComputedHeartRate ?? state?.heartRateBpm ?? state?.HeartRate;
  const bpm =
    typeof rawBpm === 'number' && Number.isFinite(rawBpm) && rawBpm > 0 && rawBpm < 250
      ? Math.round(rawBpm)
      : undefined;

  if (bpm !== undefined) {
    latestHrBpm = bpm;
    latestHrTimestamp = now;
  }

  const devId = state?.DeviceId || hrDeviceId || connectedHrDeviceId || undefined;
  connectedHrDeviceId = devId;
  const name = devId ? `Pulsómetro ANT+ #${devId}` : 'Pulsómetro ANT+';
  const validHr = getValidHrBpm(now);

  emitHrState({
    status: 'connected',
    deviceName: name,
    deviceId: devId,
    heartRateBpm: validHr,
    batteryStatus: state?.BatteryStatus,
  });

  if (lastEmittedHr !== validHr && (isTrainerActive || isHrActive || telemetryListeners.size > 0)) {
    const referencePedalMs =
      lastP25Ms > 0
        ? lastP25Ms
        : lastFreshPedalingMs > 0
        ? lastFreshPedalingMs
        : lastFitnessPacketMs;
    const pedalingTimedOut =
      referencePedalMs === 0 || now - referencePedalMs > PEDALING_TIMEOUT_MS;
    const p = pedalingTimedOut ? 0 : lastEmittedPower;
    const c = pedalingTimedOut ? 0 : lastEmittedCadence;
    const s = pedalingTimedOut ? 0 : lastEmittedSpeed;
    lastEmittedHr = validHr;

    emitTelemetry({
      timestamp: now,
      powerWatts: p,
      targetWatts: currentTargetWatts,
      cadenceRpm: c,
      speedKmh: s,
      heartRateBpm: validHr,
      distanceMeters: lastEmittedDistance,
    });
  }
}

/**
 * Processes an incoming ANT+ FE-C fitnessData packet without mutating or trusting sensor.state.
 * Keeps an independent copy of the last valid Page 25 (lastP25EventCount, lastP25AccumPower,
 * lastP25Power, lastP25Cadence, lastP25Ms). Non-counter packets (Page 16 or post-READY delete)
 * hold the last Page 25 power/cadence until PEDALING_TIMEOUT_MS expires.
 */
export function handleFitnessData(
  state: any,
  antDeviceId: number = 0,
  now: number = Date.now()
): void {
  lastClockMs = now;
  isTrainerActive = true;
  lastFitnessPacketMs = now;
  if (antDeviceId > 0 && (desiredTrainerDeviceId === undefined || desiredTrainerDeviceId === 0)) {
    desiredTrainerDeviceId = antDeviceId;
  }
  startTelemetryWatchdog();

  // If no dedicated ANT+ HR strap is active, accept valid embedded trainer HR and expire it if it stops arriving
  if (!isHrActive && !hrSensor && desiredHrDeviceId === undefined) {
    const trainerHr = state?.HeartRate ?? state?.heartRateBpm;
    if (typeof trainerHr === 'number' && Number.isFinite(trainerHr) && trainerHr > 0 && trainerHr < 250) {
      latestHrBpm = Math.round(trainerHr);
      latestHrTimestamp = now;
    }
  }

  const hasSpeedField =
    (typeof state?.speedKmh === 'number' && Number.isFinite(state.speedKmh)) ||
    (typeof state?.RealSpeed === 'number' && Number.isFinite(state.RealSpeed)) ||
    (typeof state?.VirtualSpeed === 'number' && Number.isFinite(state.VirtualSpeed));

  const packetSpeedKmh =
    typeof state?.speedKmh === 'number' && Number.isFinite(state.speedKmh)
      ? Math.max(0, Math.round(state.speedKmh * 10) / 10)
      : hasSpeedField
      ? Math.max(0, Math.round(((state?.RealSpeed ?? state?.VirtualSpeed ?? 0) * 3.6) * 10) / 10)
      : undefined;

  if (packetSpeedKmh !== undefined && packetSpeedKmh > 0) {
    lastKnownSpeedKmh = packetSpeedKmh;
  }

  const rawEventCount = state?._EventCount0x19 ?? state?.EventCount;
  const eventCount =
    typeof rawEventCount === 'number' && Number.isFinite(rawEventCount)
      ? rawEventCount
      : undefined;

  const rawAccumPower = state?.AccumulatedPower;
  const accumPower =
    typeof rawAccumPower === 'number' && Number.isFinite(rawAccumPower)
      ? rawAccumPower
      : undefined;

  const isNewP25 = eventCount !== undefined && eventCount !== lastP25EventCount;

  if (isNewP25) {
    const rawPower =
      typeof state?.InstantaneousPower === 'number' && Number.isFinite(state.InstantaneousPower)
        ? Math.max(0, Math.round(state.InstantaneousPower))
        : typeof state?.powerWatts === 'number' && Number.isFinite(state.powerWatts)
        ? Math.max(0, Math.round(state.powerWatts))
        : 0;

    const rawCadence =
      typeof state?.Cadence === 'number' && state.Cadence !== 255 && Number.isFinite(state.Cadence)
        ? Math.max(0, Math.round(state.Cadence))
        : typeof state?.cadenceRpm === 'number' && Number.isFinite(state.cadenceRpm)
        ? Math.max(0, Math.round(state.cadenceRpm))
        : 0;

    const explicitZeroCadence = state?.Cadence === 0 || state?.cadenceRpm === 0;

    // After a READY state wipe in ant-plus-next, AccumulatedPower restarts from raw uint16 (may be < lastP25AccumPower).
    // Only treat AccumulatedPower as zero-delta if counters were NOT cleared and accumPower is identical to lastP25AccumPower.
    const zeroAccumDeltaOnNewEvent =
      !p25CountersCleared &&
      accumPower !== undefined &&
      lastP25AccumPower !== undefined &&
      accumPower === lastP25AccumPower;

    const stoppedByZeroCadence =
      explicitZeroCadence && (rawPower === 0 || zeroAccumDeltaOnNewEvent);

    const stoppedOnP25 =
      stoppedByZeroCadence ||
      (rawPower === 0 && rawCadence === 0) ||
      (zeroAccumDeltaOnNewEvent && rawCadence === 0);

    lastP25EventCount = eventCount;
    if (accumPower !== undefined) {
      lastP25AccumPower = accumPower;
    }

    if (stoppedOnP25) {
      lastP25Power = 0;
      lastP25Cadence = 0;
      lastP25Ms = 0;
      lastFreshPedalingMs = 0;
      lastKnownSpeedKmh = 0;
      p25CountersCleared = true;
    } else {
      lastP25Power = rawPower;
      lastP25Cadence = rawCadence;
      lastP25Ms = now;
      lastFreshPedalingMs = now;
      p25CountersCleared = false;
      if (packetSpeedKmh !== undefined) {
        lastKnownSpeedKmh = packetSpeedKmh;
      }
    }
  } else {
    // Non-counter packet (Page 16, or after READY k(t) delete) or repeated EventCount:
    // Mark if counters were cleared by READY so the next Page 25 raw AccumulatedPower is not treated as frozen/rollback.
    if (eventCount === undefined || accumPower === undefined || state?.State === 'READY') {
      p25CountersCleared = true;
    }
  }

  const pedalingStale =
    lastP25Ms <= 0 || now - lastP25Ms > PEDALING_TIMEOUT_MS;

  if (pedalingStale) {
    p25CountersCleared = true;
    lastKnownSpeedKmh = 0;
  }

  const finalPower = pedalingStale ? 0 : lastP25Power;
  const finalCadence = pedalingStale ? 0 : lastP25Cadence;
  const finalSpeed = pedalingStale
    ? 0
    : packetSpeedKmh !== undefined && packetSpeedKmh > 0
    ? packetSpeedKmh
    : lastKnownSpeedKmh;
  const finalHr = getValidHrBpm(now);
  const finalDistance =
    typeof state?.Distance === 'number' && Number.isFinite(state.Distance)
      ? state.Distance
      : typeof state?.distanceMeters === 'number' && Number.isFinite(state.distanceMeters)
      ? state.distanceMeters
      : lastEmittedDistance;

  lastEmittedPower = finalPower;
  lastEmittedCadence = finalCadence;
  lastEmittedSpeed = finalSpeed;
  lastEmittedDistance = finalDistance;
  lastEmittedHr = finalHr;

  const telemetry: TrainerTelemetry = {
    timestamp: now,
    powerWatts: finalPower,
    targetWatts: currentTargetWatts,
    cadenceRpm: finalCadence,
    speedKmh: finalSpeed,
    heartRateBpm: finalHr,
    distanceMeters: finalDistance,
  };

  emitTelemetry(telemetry);
}

async function ensureStickOpen(): Promise<{ ok: boolean; stickName?: string; error?: string }> {
  if (currentStick) {
    return { ok: true, stickName: currentStickName };
  }

  const conflict = checkForAntConflict();
  if (conflict) {
    return { ok: false, error: conflict };
  }

  if (usb.findByIds(0x0fcf, 0x1009)) {
    currentStick = new PatchedGarminStick3();
    currentStickName = 'ANT+ USB-m (Stick 3)';
  } else if (usb.findByIds(0x0fcf, 0x1008)) {
    currentStick = new PatchedGarminStick2();
    currentStickName = 'ANT+ USB2 (Stick 2)';
  } else if (isTestStubEnvironment()) {
    currentStick = new PatchedGarminStick3();
    currentStickName = 'ANT+ USB-m (Stick 3)';
  } else {
    const noStickMsg =
      'No se ha detectado ningÃºn pincho ANT+ USB conectado (Stick 2 o Stick 3). Conecta el receptor USB y vuelve a intentarlo.';
    return { ok: false, error: noStickMsg };
  }

  try {
    await currentStick.open();
    return { ok: true, stickName: currentStickName };
  } catch (openErr: any) {
    currentStick = null;
    const postConflict = checkForAntConflict();
    const finalMsg =
      postConflict ||
      (openErr && openErr.message === 'ANT_STARTUP_TIMEOUT'
        ? 'Tiempo de espera agotado al inicializar el pincho ANT+ USB (sin respuesta a reset).'
        : openErr?.message || 'Error al abrir el receptor ANT+ USB.');
    return { ok: false, error: finalMsg };
  }
}

export function onAntState(cb: StateListener): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

export function onAntDevices(cb: DevicesListener): () => void {
  devicesListeners.add(cb);
  return () => devicesListeners.delete(cb);
}

export function onAntTelemetry(cb: TelemetryListener): () => void {
  telemetryListeners.add(cb);
  return () => telemetryListeners.delete(cb);
}

export function onAntHrState(cb: HrStateListener): () => void {
  hrStateListeners.add(cb);
  return () => hrStateListeners.delete(cb);
}

export async function startScan(): Promise<{ ok: boolean; stickName?: string; error?: string }> {
  // Check for Garmin Express / Zwift conflict first
  const conflict = checkForAntConflict();
  if (conflict) {
    emitState({
      transport: 'ant',
      status: 'error',
      errorMessage: conflict,
    });
    return { ok: false, error: conflict };
  }

  try {
    if (scanner && currentStick) {
      emitState({
        transport: 'ant',
        status: 'scanning',
        antStickType: currentStickName,
      });
      emitDevices(Array.from(discoveredDevicesMap.values()));
      return { ok: true, stickName: currentStickName };
    }

    // If hrSensor is attached, remember target and detach temporarily while scanning FE-C
    if (hrSensor) {
      const savedHrTarget = desiredHrDeviceId ?? connectedHrDeviceId ?? 0;
      desiredHrDeviceId = savedHrTarget;
      const oldHr = hrSensor;
      hrSensor = null;
      try {
        oldHr.removeAllListeners();
        await oldHr.detach();
      } catch {}
    }

    if (sensor) {
      const oldSensor = sensor;
      sensor = null;
      try {
        oldSensor.removeAllListeners();
        await oldSensor.detach();
      } catch {}
    }

    const stickRes = await ensureStickOpen();
    if (!stickRes.ok || !currentStick) {
      emitState({
        transport: 'ant',
        status: 'error',
        errorMessage: stickRes.error,
      });
      return { ok: false, error: stickRes.error };
    }

    emitState({
      transport: 'ant',
      status: 'scanning',
      antStickType: currentStickName,
    });

    scanner = new FitnessEquipmentScanner(currentStick);
    scanner.on('fitnessData', (state: any) => {
      const deviceId = state.DeviceId;
      if (!deviceId) return;
      const discovered: DiscoveredDevice = {
        id: `ant-${deviceId}`,
        name: `Rodillo ANT+ FE-C #${deviceId}`,
        transport: 'ant',
        antDeviceId: deviceId,
        rssi: state.Rssi,
      };
      discoveredDevicesMap.set(deviceId, discovered);
      emitDevices(Array.from(discoveredDevicesMap.values()));
    });

    await scanner.scan();
    return { ok: true, stickName: currentStickName };
  } catch (err: any) {
    const postConflict = checkForAntConflict();
    const finalMsg = postConflict || err?.message || 'Error durante el escaneo ANT+';
    emitState({
      transport: 'ant',
      status: 'error',
      errorMessage: finalMsg,
    });
    return { ok: false, error: finalMsg };
  }
}

export async function stopScan(): Promise<void> {
  if (scanner) {
    try {
      await detachScannerSafely(scanner);
    } catch {}
    scanner = null;
  }
  if (!sensor) {
    emitState({
      transport: 'ant',
      status: 'disconnected',
      antStickType: currentStickName,
    });
  }

  // As soon as stopScan finishes, automatically re-attach hrSensor if desiredHrDeviceId was set!
  if (desiredHrDeviceId !== undefined && !hrSensor && currentStick) {
    connectHr(desiredHrDeviceId).catch(() => {});
  }
}

export async function connectDevice(
  antDeviceId: number
): Promise<{ ok: boolean; error?: string }> {
  const conflict = checkForAntConflict();
  if (conflict) {
    emitState({
      transport: 'ant',
      status: 'error',
      errorMessage: conflict,
    });
    return { ok: false, error: conflict };
  }

  try {
    if (scanner) {
      try {
        await detachScannerSafely(scanner);
      } catch {}
      scanner = null;
    }

    const stickRes = await ensureStickOpen();
    if (!stickRes.ok || !currentStick) {
      emitState({
        transport: 'ant',
        status: 'error',
        errorMessage: stickRes.error,
      });
      return { ok: false, error: stickRes.error };
    }

    const deviceDisplayName =
      antDeviceId === 0 ? 'Rodillo ANT+ FE-C' : `Rodillo ANT+ FE-C #${antDeviceId}`;

    emitState({
      transport: 'ant',
      status: 'connecting',
      deviceName: deviceDisplayName,
      antStickType: currentStickName,
    });

    if (sensor) {
      const oldSensor = sensor;
      sensor = null;
      try {
        oldSensor.removeAllListeners();
        await oldSensor.detach();
      } catch {}
    }

    const now = lastClockMs > 0 && isTestStubEnvironment() ? lastClockMs : Date.now();
    desiredTrainerDeviceId = antDeviceId;
    fecReattachAttemptMs = 0;
    isReconnectingFec = false;
    lastFitnessPacketMs = now;
    lastFreshPedalingMs = 0;
    lastP25EventCount = undefined;
    lastP25AccumPower = undefined;
    lastP25Power = 0;
    lastP25Cadence = 0;
    lastP25Ms = 0;
    p25CountersCleared = true;
    lastKnownSpeedKmh = 0;
    isTrainerActive = true;

    const nextSensor = new FitnessEquipmentSensor(currentStick);
    sensor = nextSensor;
    bindFecSensorListeners(nextSensor, antDeviceId);

    // Attach to channel 0 with target deviceId (0 = wildcard pair nearest)
    await nextSensor.attach(0, antDeviceId);

    connectedDeviceName = deviceDisplayName;
    emitState({
      transport: 'ant',
      status: 'connected',
      deviceName: connectedDeviceName,
      antStickType: currentStickName,
    });

    if (controlMode === 'resistance') {
      nextSensor.setBasicResistance(currentResistancePercent).catch(() => {});
    } else if (currentTargetWatts > 0) {
      nextSensor.setTargetPower(currentTargetWatts).catch(() => {});
    }
    startKeepAlive();
    startTelemetryWatchdog();

    // As soon as connectDevice finishes, automatically re-attach hrSensor if desiredHrDeviceId was set!
    if (desiredHrDeviceId !== undefined && !hrSensor && currentStick) {
      connectHr(desiredHrDeviceId).catch(() => {});
    }

    return { ok: true };
  } catch (err: any) {
    const postConflict = checkForAntConflict();
    const finalMsg =
      postConflict || err?.message || 'Error al conectar con el rodillo ANT+ FE-C.';
    emitState({
      transport: 'ant',
      status: 'error',
      errorMessage: finalMsg,
      antStickType: currentStickName,
    });
    return { ok: false, error: finalMsg };
  }
}

export async function connectHr(
  hrDeviceId: number = 0
): Promise<{ ok: boolean; error?: string }> {
  const conflict = checkForAntConflict();
  if (conflict) {
    emitHrState({
      status: 'error',
      errorMessage: conflict,
    });
    return { ok: false, error: conflict };
  }

  desiredHrDeviceId = hrDeviceId;
  hrConnectAttemptTimestamp = lastClockMs > 0 && isTestStubEnvironment() ? lastClockMs : Date.now();
  isHrActive = true;

  // If scanner (FE-C RxScanMode) is actively scanning, stop it first so channel 1 can attach cleanly
  if (scanner) {
    try {
      await detachScannerSafely(scanner);
    } catch {}
    scanner = null;
  }

  const stickRes = await ensureStickOpen();
  if (!stickRes.ok || !currentStick) {
    emitHrState({
      status: 'error',
      errorMessage: stickRes.error,
    });
    return { ok: false, error: stickRes.error };
  }

  const hrDisplayName =
    hrDeviceId > 0 ? `PulsÃ³metro ANT+ #${hrDeviceId}` : 'PulsÃ³metro ANT+';

  emitHrState({
    status: 'connecting',
    deviceName: hrDisplayName,
    deviceId: hrDeviceId > 0 ? hrDeviceId : undefined,
  });

  if (hrSensor) {
    const oldHr = hrSensor;
    hrSensor = null;
    try {
      oldHr.removeAllListeners();
      await oldHr.detach();
    } catch {}
  }

  hrSensor = new HeartRateSensor(currentStick);
  hrSensor.on('heartRateData', (state: any) => {
    handleHeartRateData(state, hrDeviceId, Date.now());
  });

  try {
    // Attach to channel 1 with target deviceId (0 = wildcard pair nearest)
    await hrSensor.attach(1, hrDeviceId ?? 0);
    hrConnectAttemptTimestamp = lastClockMs > 0 && isTestStubEnvironment() ? lastClockMs : Date.now();
    startTelemetryWatchdog();
    emitHrState({
      status: 'connected',
      deviceName: hrDisplayName,
      deviceId: hrDeviceId > 0 ? hrDeviceId : undefined,
      heartRateBpm: getValidHrBpm(),
    });
    return { ok: true };
  } catch (err: any) {
    const postConflict = checkForAntConflict();
    const finalMsg =
      postConflict || err?.message || 'Error al conectar el pulsÃ³metro ANT+.';
    emitHrState({
      status: 'error',
      errorMessage: finalMsg,
    });
    return { ok: false, error: finalMsg };
  }
}

export async function disconnectHr(): Promise<void> {
  desiredHrDeviceId = undefined;
  connectedHrDeviceId = undefined;
  latestHrBpm = undefined;
  latestHrTimestamp = 0;
  hrConnectAttemptTimestamp = 0;
  isReconnectingHr = false;
  isHrActive = false;
  lastEmittedHr = undefined;

  if (hrSensor) {
    const oldHr = hrSensor;
    hrSensor = null;
    try {
      oldHr.removeAllListeners();
      await oldHr.detach();
    } catch {}
  }

  if (!sensor && !isTrainerActive) {
    stopTelemetryWatchdog();
  }

  emitHrState({
    status: 'disconnected',
  });

  // ONLY close currentStick if neither trainer sensor nor scanner is active!
  if (!sensor && !scanner && currentStick) {
    try {
      await currentStick.close();
    } catch {}
    currentStick = null;
  }
}

export async function setTargetPower(
  watts: number
): Promise<{ ok: boolean; error?: string }> {
  controlMode = 'erg';
  currentTargetWatts = Math.round(Math.max(0, Math.min(2000, watts)));
  startKeepAlive();

  if (sensor) {
    try {
      await sensor.setTargetPower(currentTargetWatts);
      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Error al fijar objetivo de potencia ERG',
      };
    }
  }
  return { ok: true };
}

export async function setBasicResistance(
  percent: number
): Promise<{ ok: boolean; error?: string }> {
  const safePercent = Number.isFinite(percent) ? percent : 0;
  const clamped = Math.round(Math.max(0, Math.min(100, safePercent)) * 2) / 2;
  controlMode = 'resistance';
  currentResistancePercent = clamped;
  startKeepAlive();

  if (sensor) {
    try {
      await sensor.setBasicResistance(clamped);
      return { ok: true };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Error al fijar resistencia básica ANT+',
      };
    }
  }
  return { ok: true };
}

export async function disconnect(): Promise<void> {
  stopKeepAlive();

  isTrainerActive = false;
  desiredTrainerDeviceId = undefined;
  fecReattachAttemptMs = 0;
  isReconnectingFec = false;
  lastFitnessPacketMs = 0;
  lastFreshPedalingMs = 0;
  lastP25EventCount = undefined;
  lastP25AccumPower = undefined;
  lastP25Power = 0;
  lastP25Cadence = 0;
  lastP25Ms = 0;
  p25CountersCleared = false;
  lastKnownSpeedKmh = 0;
  lastEmittedPower = 0;
  lastEmittedCadence = 0;
  lastEmittedSpeed = 0;
  lastEmittedDistance = undefined;
  lastWatchdogZeroEmitMs = 0;

  if (!hrSensor && desiredHrDeviceId === undefined && !isHrActive) {
    stopTelemetryWatchdog();
  }

  if (sensor) {
    const oldSensor = sensor;
    sensor = null;
    try {
      oldSensor.removeAllListeners();
      await oldSensor.detach();
    } catch {}
  }

  if (scanner) {
    try {
      await detachScannerSafely(scanner);
    } catch {}
    scanner = null;
  }

  connectedDeviceName = undefined;
  currentTargetWatts = 0;
  controlMode = 'erg';
  currentResistancePercent = 15;

  emitState({
    transport: 'ant',
    status: 'disconnected',
    antStickType: currentStickName,
  });

  // ONLY close currentStick if hrSensor is NOT active!
  if (!hrSensor && currentStick) {
    try {
      await currentStick.close();
    } catch {}
    currentStick = null;
  }
}

export const disconnectDevice = disconnect;

export async function closeStick(): Promise<void> {
  stopKeepAlive();
  stopTelemetryWatchdog();
  await disconnectHr();
  await disconnect();
  if (currentStick) {
    try {
      await currentStick.close();
    } catch {}
    currentStick = null;
  }
}

/**
 * Helper for deterministic unit tests to reset or seed internal ANT+ manager state.
 */
export function __resetAntStateForTests(opts?: {
  stick?: any;
  sensor?: any;
  hrSensor?: any;
  antDeviceId?: number;
  targetWatts?: number;
  controlMode?: 'erg' | 'resistance';
  resistancePercent?: number;
  now?: number;
  clearListeners?: boolean;
}): void {
  stopKeepAlive();
  stopTelemetryWatchdog();

  if (sensor) {
    try {
      sensor.removeAllListeners();
    } catch {}
  }
  if (hrSensor) {
    try {
      hrSensor.removeAllListeners();
    } catch {}
  }

  currentStick = opts?.stick ?? null;
  currentStickName = currentStick ? 'ANT+ USB-m (Stick 3)' : '';
  scanner = null;
  sensor = opts?.sensor ?? null;
  hrSensor = opts?.hrSensor ?? null;
  currentTargetWatts = opts?.targetWatts ?? 0;
  controlMode = opts?.controlMode ?? 'erg';
  currentResistancePercent = opts?.resistancePercent ?? 15;
  connectedDeviceName = undefined;
  desiredTrainerDeviceId = opts?.antDeviceId;
  fecReattachAttemptMs = 0;
  isReconnectingFec = false;
  connectedHrDeviceId = undefined;
  desiredHrDeviceId = undefined;
  latestHrBpm = undefined;
  latestHrTimestamp = 0;
  hrConnectAttemptTimestamp = 0;
  isReconnectingHr = false;

  lastClockMs = opts?.now ?? 0;
  lastFitnessPacketMs = opts?.now ?? 0;
  lastFreshPedalingMs = 0;
  lastP25EventCount = undefined;
  lastP25AccumPower = undefined;
  lastP25Power = 0;
  lastP25Cadence = 0;
  lastP25Ms = 0;
  p25CountersCleared = false;
  lastKnownSpeedKmh = 0;
  lastEmittedPower = 0;
  lastEmittedCadence = 0;
  lastEmittedSpeed = 0;
  lastEmittedDistance = undefined;
  lastEmittedHr = undefined;
  lastWatchdogZeroEmitMs = 0;
  isTrainerActive = sensor !== null;
  isHrActive = hrSensor !== null;

  if (sensor) {
    const devId = opts?.antDeviceId ?? 0;
    desiredTrainerDeviceId = devId;
    connectedDeviceName =
      devId === 0 ? 'Rodillo ANT+ FE-C' : `Rodillo ANT+ FE-C #${devId}`;
    bindFecSensorListeners(sensor, devId);
  }

  if (opts?.clearListeners) {
    stateListeners.clear();
    devicesListeners.clear();
    telemetryListeners.clear();
    hrStateListeners.clear();
  }
}

export function __getAntStateForTests() {
  return {
    currentStick,
    scanner,
    sensor,
    hrSensor,
    desiredTrainerDeviceId,
    currentTargetWatts,
    controlMode,
    currentResistancePercent,
    lastFitnessPacketMs,
    lastP25EventCount,
    lastP25AccumPower,
    lastP25Power,
    lastP25Cadence,
    lastP25Ms,
    fecReattachAttemptMs,
    isReconnectingFec,
  };
}

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
  'Garmin Express (o Rouvy/Zwift) está abierto en segundo plano y bloquea el pincho ANT+ USB. Ciérralo desde la bandeja del sistema (junto al reloj de Windows) y vuelve a pulsar Escanear.';

export function checkForAntConflict(): string | null {
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
    return false;
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

// Internal State
let currentStick: PatchedGarminStick3 | PatchedGarminStick2 | null = null;
let currentStickName: string = '';
let scanner: FitnessEquipmentScanner | null = null;
let sensor: FitnessEquipmentSensor | null = null;
let hrSensor: HeartRateSensor | null = null;
let currentTargetWatts: number = 0;
let keepAliveTimer: NodeJS.Timeout | null = null;
let connectedDeviceName: string | undefined = undefined;
let connectedHrDeviceId: number | undefined = undefined;
let desiredHrDeviceId: number | undefined = undefined;
let latestHrBpm: number | undefined = undefined;

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
    if (sensor && currentTargetWatts >= 0) {
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
  } else {
    const noStickMsg =
      'No se ha detectado ningún pincho ANT+ USB conectado (Stick 2 o Stick 3). Conecta el receptor USB y vuelve a intentarlo.';
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
      try {
        await hrSensor.detach();
      } catch {}
      hrSensor = null;
    }

    if (sensor) {
      try {
        await sensor.detach();
      } catch {}
      sensor = null;
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
      await scanner.detach();
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
        await scanner.detach();
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
      try {
        await sensor.detach();
      } catch {}
      sensor = null;
    }

    sensor = new FitnessEquipmentSensor(currentStick);
    let isConnectedReported = false;

    sensor.on('fitnessData', (state: any) => {
      const devId = state.DeviceId || antDeviceId;
      const trainerName = devId ? `Rodillo ANT+ FE-C #${devId}` : 'Rodillo ANT+ FE-C';

      if (!isConnectedReported) {
        isConnectedReported = true;
        connectedDeviceName = trainerName;
        emitState({
          transport: 'ant',
          status: 'connected',
          deviceName: trainerName,
          antStickType: currentStickName,
        });
      }

      const hrFromTrainer =
        state.HeartRate && state.HeartRate !== 255 ? state.HeartRate : undefined;
      const finalHr = latestHrBpm ?? hrFromTrainer;

      const telemetry: TrainerTelemetry = {
        timestamp: Date.now(),
        powerWatts:
          typeof state.InstantaneousPower === 'number' ? state.InstantaneousPower : 0,
        targetWatts: currentTargetWatts,
        cadenceRpm:
          state.Cadence && state.Cadence !== 255 ? state.Cadence : 0,
        speedKmh:
          Math.round(((state.RealSpeed ?? state.VirtualSpeed ?? 0) * 3.6) * 10) / 10,
        heartRateBpm: finalHr,
        distanceMeters:
          typeof state.Distance === 'number' ? state.Distance : undefined,
      };

      emitTelemetry(telemetry);
    });

    // Attach to channel 0 with target deviceId (0 = wildcard pair nearest)
    await sensor.attach(0, antDeviceId);

    connectedDeviceName = deviceDisplayName;
    emitState({
      transport: 'ant',
      status: 'connected',
      deviceName: connectedDeviceName,
      antStickType: currentStickName,
    });

    if (currentTargetWatts > 0) {
      sensor.setTargetPower(currentTargetWatts).catch(() => {});
    }
    startKeepAlive();

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

  // If scanner (FE-C RxScanMode) is actively scanning, stop it first so channel 1 can attach cleanly
  if (scanner) {
    try {
      await scanner.detach();
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
    hrDeviceId > 0 ? `Pulsómetro ANT+ #${hrDeviceId}` : 'Pulsómetro ANT+';

  emitHrState({
    status: 'connecting',
    deviceName: hrDisplayName,
    deviceId: hrDeviceId > 0 ? hrDeviceId : undefined,
  });

  if (hrSensor) {
    try {
      await hrSensor.detach();
    } catch {}
    hrSensor = null;
  }

  hrSensor = new HeartRateSensor(currentStick);
  let isHrConnectedReported = false;

  hrSensor.on('heartRateData', (state: any) => {
    const bpm =
      state.ComputedHeartRate &&
      state.ComputedHeartRate > 0 &&
      state.ComputedHeartRate < 250
        ? state.ComputedHeartRate
        : undefined;

    if (bpm !== undefined) {
      latestHrBpm = bpm;
    }

    const devId = state.DeviceId || hrDeviceId || undefined;
    connectedHrDeviceId = devId;
    const name = devId ? `Pulsómetro ANT+ #${devId}` : 'Pulsómetro ANT+';

    if (!isHrConnectedReported) {
      isHrConnectedReported = true;
    }

    emitHrState({
      status: 'connected',
      deviceName: name,
      deviceId: devId,
      heartRateBpm: bpm,
      batteryStatus: state.BatteryStatus,
    });
  });

  try {
    // Attach to channel 1 with target deviceId (0 = wildcard pair nearest)
    await hrSensor.attach(1, hrDeviceId ?? 0);
    emitHrState({
      status: 'connected',
      deviceName: hrDisplayName,
      deviceId: hrDeviceId > 0 ? hrDeviceId : undefined,
    });
    return { ok: true };
  } catch (err: any) {
    const postConflict = checkForAntConflict();
    const finalMsg =
      postConflict || err?.message || 'Error al conectar el pulsómetro ANT+.';
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

  if (hrSensor) {
    try {
      await hrSensor.detach();
    } catch {}
    hrSensor = null;
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

export async function disconnect(): Promise<void> {
  stopKeepAlive();

  if (sensor) {
    try {
      await sensor.detach();
    } catch {}
    sensor = null;
  }

  if (scanner) {
    try {
      await scanner.detach();
    } catch {}
    scanner = null;
  }

  connectedDeviceName = undefined;
  currentTargetWatts = 0;

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

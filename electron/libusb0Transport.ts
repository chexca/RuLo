/**
 * Native libusb-win32 (libusb0.dll) transport for ANT+ USB sticks on Windows.
 *
 * Why: when the ANT stick is bound to the legacy `libusb0.sys` driver (installed by
 * Garmin / Zwift / Rouvy), node-usb (libusb-1.0) submits bulk transfers that complete
 * with length 0 and never reach the device. Talking directly to the system
 * `libusb0.dll` works reliably, so we use it through koffi FFI.
 */
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const koffi = require('koffi');

const ETIMEDOUT = -116;

// x64 struct offsets for libusb-win32 1.2.x (LIBUSB_PATH_MAX = 512)
const BUS_NEXT_OFFSET = 0;
const BUS_DEVICES_OFFSET = 528;
const DEV_NEXT_OFFSET = 0;
const DEV_ID_VENDOR_OFFSET = 544; // descriptor @536 + idVendor @8
const DEV_ID_PRODUCT_OFFSET = 546;

interface Libusb0Api {
  usb_init: () => void;
  usb_find_busses: () => number;
  usb_find_devices: () => number;
  usb_get_busses: () => any;
  usb_open: (dev: any) => any;
  usb_close: (h: any) => number;
  usb_set_configuration: (h: any, c: number) => number;
  usb_claim_interface: (h: any, i: number) => number;
  usb_release_interface: (h: any, i: number) => number;
  usb_bulk_write: any;
  usb_bulk_read: any;
}

let api: Libusb0Api | null = null;
let apiLoadError: string | null = null;

function libusb0DllPath(): string | null {
  if (process.platform !== 'win32') return null;
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'libusb0.dll');
  return fs.existsSync(sys) ? sys : null;
}

function loadApi(): Libusb0Api | null {
  if (api || apiLoadError) return api;
  try {
    const dllPath = libusb0DllPath();
    if (!dllPath) {
      apiLoadError = 'libusb0.dll not found';
      return null;
    }
    const lib = koffi.load(dllPath);
    api = {
      usb_init: lib.func('void usb_init()'),
      usb_find_busses: lib.func('int usb_find_busses()'),
      usb_find_devices: lib.func('int usb_find_devices()'),
      usb_get_busses: lib.func('void* usb_get_busses()'),
      usb_open: lib.func('void* usb_open(void* dev)'),
      usb_close: lib.func('int usb_close(void* h)'),
      usb_set_configuration: lib.func('int usb_set_configuration(void* h, int c)'),
      usb_claim_interface: lib.func('int usb_claim_interface(void* h, int i)'),
      usb_release_interface: lib.func('int usb_release_interface(void* h, int i)'),
      usb_bulk_write: lib.func('int usb_bulk_write(void* h, int ep, uint8_t* buf, int size, int timeout)'),
      usb_bulk_read: lib.func('int usb_bulk_read(void* h, int ep, _Out_ uint8_t* buf, int size, int timeout)'),
    };
    api.usb_init();
    return api;
  } catch (err: any) {
    apiLoadError = err?.message || String(err);
    console.warn('[libusb0] Could not load libusb0.dll:', apiLoadError);
    return null;
  }
}

function readPtr(base: any, offset: number): any {
  const p = koffi.decode(base, offset, 'void*');
  return p;
}

function readU16(base: any, offset: number): number {
  return koffi.decode(base, offset, 'uint16_t') as number;
}

function findDevice(a: Libusb0Api, vendorId: number, productId: number): any | null {
  a.usb_find_busses();
  a.usb_find_devices();
  let bus = a.usb_get_busses();
  let guard = 0;
  while (bus && guard++ < 64) {
    let dev = readPtr(bus, BUS_DEVICES_OFFSET);
    let devGuard = 0;
    while (dev && devGuard++ < 128) {
      if (readU16(dev, DEV_ID_VENDOR_OFFSET) === vendorId && readU16(dev, DEV_ID_PRODUCT_OFFSET) === productId) {
        return dev;
      }
      dev = readPtr(dev, DEV_NEXT_OFFSET);
    }
    bus = readPtr(bus, BUS_NEXT_OFFSET);
  }
  return null;
}

/** True if the given ANT stick is reachable through native libusb0.dll. */
export function isLibusb0DevicePresent(vendorId: number, productId: number): boolean {
  const a = loadApi();
  if (!a) return false;
  try {
    return !!findDevice(a, vendorId, productId);
  } catch {
    return false;
  }
}

export class Libusb0Transport {
  private handle: any = null;
  private running = false;
  private readonly epIn = 0x81;
  private readonly epOut = 0x01;

  constructor(private vendorId: number, private productId: number) {}

  open(): boolean {
    const a = loadApi();
    if (!a) return false;
    const dev = findDevice(a, this.vendorId, this.productId);
    if (!dev) return false;
    const h = a.usb_open(dev);
    if (!h) return false;
    a.usb_set_configuration(h, 1);
    const rc = a.usb_claim_interface(h, 0);
    if (rc < 0) {
      a.usb_close(h);
      throw new Error(`usb_claim_interface failed (${rc}). ¿Otra app (Garmin Express, Zwift, Rouvy) está usando el pincho ANT+?`);
    }
    this.handle = h;
    return true;
  }

  /** Starts an async read loop on a worker thread (does not block Electron's main thread). */
  startReading(onData: (data: Uint8Array) => void): void {
    if (!this.handle || this.running) return;
    this.running = true;
    const a = api!;
    const loop = () => {
      if (!this.running || !this.handle) return;
      const buf = Buffer.alloc(64);
      a.usb_bulk_read.async(this.handle, this.epIn, buf, 64, 250, (err: any, rc: number) => {
        if (!this.running) return;
        if (err) {
          setTimeout(loop, 50);
          return;
        }
        if (rc > 0) {
          const clean = new Uint8Array(rc);
          clean.set(buf.subarray(0, rc));
          try {
            onData(clean);
          } catch (e) {
            console.error('[libusb0] onData error:', e);
          }
          setImmediate(loop);
        } else if (rc === ETIMEDOUT || rc === 0) {
          setImmediate(loop);
        } else {
          // Other error (device unplugged, etc.) -> back off
          setTimeout(loop, 100);
        }
      });
    };
    loop();
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.handle) return reject(new Error('ANT stick not open'));
      const buf = Buffer.from(data);
      api!.usb_bulk_write.async(this.handle, this.epOut, buf, buf.length, 1000, (err: any, rc: number) => {
        if (err) return reject(err);
        if (rc < 0) return reject(new Error(`usb_bulk_write failed (${rc})`));
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.running = false;
    const h = this.handle;
    this.handle = null;
    if (!h || !api) return;
    // Give the pending async read (max 250ms) time to finish before releasing.
    await new Promise((r) => setTimeout(r, 300));
    try {
      api.usb_release_interface(h, 0);
    } catch {}
    try {
      api.usb_close(h);
    } catch {}
  }
}

import type { TrainerTelemetry, TrainerStateEvent } from '../types/workout';

// Local interfaces for Web Bluetooth to compile cleanly without external @types/web-bluetooth
interface BleDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BleRemoteGATTServer;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

interface BleRemoteGATTServer {
  device: BleDevice;
  connected: boolean;
  connect(): Promise<BleRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: BluetoothServiceUUID): Promise<BleRemoteGATTService>;
  getPrimaryServices(service?: BluetoothServiceUUID): Promise<BleRemoteGATTService[]>;
}

interface BleRemoteGATTService {
  uuid: string;
  device: BleDevice;
  isPrimary: boolean;
  getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BleRemoteGATTCharacteristic>;
  getCharacteristics(characteristic?: BluetoothCharacteristicUUID): Promise<BleRemoteGATTCharacteristic[]>;
}

interface BleRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  service: BleRemoteGATTService;
  properties: {
    broadcast: boolean;
    read: boolean;
    writeWithoutResponse: boolean;
    write: boolean;
    notify: boolean;
    indicate: boolean;
    authenticatedSignedWrites: boolean;
    reliableWrite: boolean;
    writableAuxiliaries: boolean;
  };
  value?: DataView;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource | Uint8Array): Promise<void>;
  writeValueWithResponse?(value: BufferSource | Uint8Array): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource | Uint8Array): Promise<void>;
  startNotifications(): Promise<BleRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BleRemoteGATTCharacteristic>;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

type BluetoothServiceUUID = number | string;
type BluetoothCharacteristicUUID = number | string;

interface BleRequestDeviceOptions {
  filters?: Array<{
    name?: string;
    namePrefix?: string;
    services?: BluetoothServiceUUID[];
  }>;
  optionalServices?: BluetoothServiceUUID[];
  acceptAllDevices?: boolean;
}

interface BleNavigator {
  bluetooth?: {
    requestDevice(options?: BleRequestDeviceOptions): Promise<BleDevice>;
    getAvailability?(): Promise<boolean>;
  };
}

export class BleTrainerService {
  private device: BleDevice | null = null;
  private isConnected = false;
  private deviceName = 'Dispositivo BLE';

  private onTelemetryCb?: (t: TrainerTelemetry) => void;
  private onStateChangeCb?: (s: TrainerStateEvent) => void;

  private ftmsControlPoint: BleRemoteGATTCharacteristic | null = null;
  private tacxTxChar: BleRemoteGATTCharacteristic | null = null;

  private hasFtmsPower = false;
  private hasTacxPower = false;

  private currentPowerWatts = 0;
  private currentTargetWatts = 0;
  private currentCadenceRpm = 0;
  private currentSpeedKmh = 0;
  private currentDistanceMeters = 0;
  private currentHeartRateBpm = 0;
  private lastTelemetryTime = 0;

  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Connects to a smart trainer using Web Bluetooth.
   * Seamlessly supports standard FTMS (0x1826) and Tacx FE-C over BLE (6e40fec1-b5a3-f393-e0a9-e50e24dcca9e),
   * with fallback to Cycling Power (0x1818) and Heart Rate (0x180D).
   */
  async connect(
    onTelemetry: (t: TrainerTelemetry) => void,
    onStateChange: (s: TrainerStateEvent) => void
  ): Promise<void> {
    this.onTelemetryCb = onTelemetry;
    this.onStateChangeCb = onStateChange;

    const nav = (typeof navigator !== 'undefined' ? (navigator as unknown as BleNavigator) : undefined);
    if (!nav?.bluetooth) {
      onStateChange({
        transport: 'ble',
        status: 'error',
        errorMessage: 'Web Bluetooth no está disponible en este navegador o entorno.'
      });
      return;
    }

    onStateChange({
      transport: 'ble',
      status: 'scanning'
    });

    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          0x1826, // FTMS
          0x1818, // Cycling Power
          0x180d, // Heart Rate
          '6e40fec1-b5a3-f393-e0a9-e50e24dcca9e' // Tacx FE-C over BLE
        ]
      });

      this.device = device;
      this.deviceName = device.name ?? 'Rodillo BLE';

      onStateChange({
        transport: 'ble',
        status: 'connecting',
        deviceName: this.deviceName
      });

      device.addEventListener('gattserverdisconnected', () => {
        this.handleGattDisconnected();
      });

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('No se pudo establecer conexión con el servidor GATT');
      }

      this.ftmsControlPoint = null;
      this.tacxTxChar = null;
      this.hasFtmsPower = false;
      this.hasTacxPower = false;
      this.currentDistanceMeters = 0;
      this.lastTelemetryTime = Date.now();

      // 1. Try FTMS (0x1826)
      let ftmsSupported = false;
      try {
        const ftmsService = await server.getPrimaryService(0x1826);
        if (ftmsService) {
          ftmsSupported = true;

          // Indoor Bike Data (0x2AD2)
          try {
            const bikeDataChar = await ftmsService.getCharacteristic(0x2ad2);
            await bikeDataChar.startNotifications();
            bikeDataChar.addEventListener('characteristicvaluechanged', (e: Event) => {
              const char = e.target as BleRemoteGATTCharacteristic;
              if (char.value) {
                this.handleFtmsBikeData(char.value);
              }
            });
          } catch (e) {
            console.warn('FTMS Indoor Bike Data characteristic not found', e);
          }

          // Control Point (0x2AD9)
          try {
            const cpChar = await ftmsService.getCharacteristic(0x2ad9);
            this.ftmsControlPoint = cpChar;
            try {
              await cpChar.startNotifications();
            } catch {
              // Notifications on control point are optional
            }
            // Request Control [0x00]
            await this.writeCharacteristic(cpChar, new Uint8Array([0x00]));
            await new Promise((r) => setTimeout(r, 80));
            // Start / Resume [0x07]
            await this.writeCharacteristic(cpChar, new Uint8Array([0x07]));
          } catch (e) {
            console.warn('FTMS Control Point characteristic not found', e);
          }
        }
      } catch {
        // FTMS not available on this device
      }

      // 2. If FTMS is NOT available or control point not found, try Tacx FE-C over BLE
      if (!ftmsSupported || !this.ftmsControlPoint) {
        try {
          const tacxService = await server.getPrimaryService('6e40fec1-b5a3-f393-e0a9-e50e24dcca9e');
          if (tacxService) {
            // RX Notify (6e40fec2-b5a3-f393-e0a9-e50e24dcca9e)
            try {
              const rxChar = await tacxService.getCharacteristic('6e40fec2-b5a3-f393-e0a9-e50e24dcca9e');
              await rxChar.startNotifications();
              rxChar.addEventListener('characteristicvaluechanged', (e: Event) => {
                const char = e.target as BleRemoteGATTCharacteristic;
                if (char.value) {
                  this.handleTacxFecRx(char.value);
                }
              });
            } catch (e) {
              console.warn('Tacx FE-C RX Notify characteristic not found', e);
            }

            // TX Write (6e40fec3-b5a3-f393-e0a9-e50e24dcca9e)
            try {
              const txChar = await tacxService.getCharacteristic('6e40fec3-b5a3-f393-e0a9-e50e24dcca9e');
              this.tacxTxChar = txChar;
            } catch (e) {
              console.warn('Tacx FE-C TX Write characteristic not found', e);
            }
          }
        } catch {
          // Tacx FE-C service not available
        }
      }

      // 3. Fallback: Cycling Power Service (0x1818) -> Cycling Power Measurement (0x2A63)
      try {
        const cpmService = await server.getPrimaryService(0x1818);
        const cpmChar = await cpmService.getCharacteristic(0x2a63);
        await cpmChar.startNotifications();
        cpmChar.addEventListener('characteristicvaluechanged', (e: Event) => {
          const char = e.target as BleRemoteGATTCharacteristic;
          if (char.value && char.value.byteLength >= 4) {
            if (!this.hasFtmsPower && !this.hasTacxPower) {
              this.currentPowerWatts = char.value.getInt16(2, true);
              this.emitTelemetry();
            }
          }
        });
      } catch {
        // Cycling Power Service not available
      }

      // 4. Optional: Heart Rate Service (0x180D) -> Heart Rate Measurement (0x2A37)
      try {
        const hrService = await server.getPrimaryService(0x180d);
        const hrChar = await hrService.getCharacteristic(0x2a37);
        await hrChar.startNotifications();
        hrChar.addEventListener('characteristicvaluechanged', (e: Event) => {
          const char = e.target as BleRemoteGATTCharacteristic;
          if (char.value && char.value.byteLength >= 2) {
            const flags = char.value.getUint8(0);
            this.currentHeartRateBpm = (flags & 0x01) === 0 ? char.value.getUint8(1) : char.value.getUint16(1, true);
            this.emitTelemetry();
          }
        });
      } catch {
        // HR service not available
      }

      this.isConnected = true;

      // Keep-alive: 2000ms re-sending targetWatts in ERG mode
      this.keepAliveInterval = setInterval(() => {
        if (this.isConnected && this.currentTargetWatts > 0) {
          this.setTargetPower(this.currentTargetWatts).catch(() => {});
        }
      }, 2000);

      onStateChange({
        transport: 'ble',
        status: 'connected',
        deviceName: this.deviceName
      });

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.handleGattDisconnected();
      onStateChange({
        transport: 'ble',
        status: 'error',
        errorMessage: errorMsg
      });
    }
  }

  /**
   * Sets target ERG power in Watts.
   */
  async setTargetPower(watts: number): Promise<void> {
    this.currentTargetWatts = Math.max(0, Math.round(watts));
    if (!this.isConnected) return;

    if (this.ftmsControlPoint) {
      // FTMS Set Target Power: OpCode 0x05, int16LE Watts
      const p = this.currentTargetWatts;
      const buf = new Uint8Array([0x05, p & 0xff, (p >> 8) & 0xff]);
      await this.writeCharacteristic(this.ftmsControlPoint, buf);
    } else if (this.tacxTxChar) {
      // Tacx FE-C over BLE Page 0x31 (49) Target Power frame
      // raw = watts * 4 (0.25W resolution), clamped [0, 4000]
      const raw = Math.max(0, Math.min(4000, Math.round(this.currentTargetWatts * 4)));
      const pLsb = raw & 0xff;
      const pMsb = (raw >> 8) & 0xff;
      // 12 bytes from 0xA4 through (raw >> 8) & 0xFF
      const frame = [0xa4, 0x09, 0x4f, 0x05, 0x31, 0xff, 0xff, 0xff, 0xff, 0xff, pLsb, pMsb];
      let cs = 0;
      for (let i = 0; i < frame.length; i++) {
        cs ^= frame[i];
      }
      frame.push(cs);
      await this.writeCharacteristic(this.tacxTxChar, new Uint8Array(frame));
    }
  }

  /**
   * Disconnects the Bluetooth device and clears timers.
   */
  async disconnect(): Promise<void> {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleGattDisconnected();
  }

  private handleGattDisconnected(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    const wasConnected = this.isConnected;
    this.isConnected = false;
    this.ftmsControlPoint = null;
    this.tacxTxChar = null;
    this.hasFtmsPower = false;
    this.hasTacxPower = false;

    if (wasConnected && this.onStateChangeCb) {
      this.onStateChangeCb({
        transport: 'ble',
        status: 'disconnected',
        deviceName: this.deviceName
      });
    }
  }

  /**
   * Parses FTMS Indoor Bike Data (0x2AD2).
   */
  private handleFtmsBikeData(dataView: DataView): void {
    if (dataView.byteLength < 2) return;
    const flags = dataView.getUint16(0, true);
    let offset = 2;

    // Instantaneous Speed: present if bit 0 is 0 (0.01 km/h)
    if ((flags & 0x0001) === 0) {
      if (offset + 2 <= dataView.byteLength) {
        const rawSpeed = dataView.getUint16(offset, true);
        this.currentSpeedKmh = rawSpeed * 0.01;
        offset += 2;
      }
    }

    // Average Speed
    if (flags & 0x0002) {
      offset += 2;
    }

    // Instantaneous Cadence: present if bit 2 is 1 (0.5 RPM)
    if (flags & 0x0004) {
      if (offset + 2 <= dataView.byteLength) {
        const rawCadence = dataView.getUint16(offset, true);
        this.currentCadenceRpm = rawCadence * 0.5;
        offset += 2;
      }
    }

    // Average Cadence
    if (flags & 0x0008) {
      offset += 2;
    }

    // Total Distance (uint24 meters)
    if (flags & 0x0010) {
      if (offset + 3 <= dataView.byteLength) {
        const d0 = dataView.getUint8(offset);
        const d1 = dataView.getUint8(offset + 1);
        const d2 = dataView.getUint8(offset + 2);
        this.currentDistanceMeters = d0 | (d1 << 8) | (d2 << 16);
        offset += 3;
      }
    }

    // Resistance Level
    if (flags & 0x0020) {
      offset += 2;
    }

    // Instantaneous Power: present if bit 6 is 1 (int16LE Watts)
    if (flags & 0x0040) {
      if (offset + 2 <= dataView.byteLength) {
        this.currentPowerWatts = dataView.getInt16(offset, true);
        this.hasFtmsPower = true;
        offset += 2;
      }
    }

    // Average Power
    if (flags & 0x0080) {
      offset += 2;
    }

    // Expended Energy (uint16 + uint16 + uint8 = 5 bytes)
    if (flags & 0x0100) {
      offset += 5;
    }

    // Heart Rate: present if bit 9 is 1 (uint8 BPM)
    if (flags & 0x0200) {
      if (offset + 1 <= dataView.byteLength) {
        this.currentHeartRateBpm = dataView.getUint8(offset);
        offset += 1;
      }
    }

    this.emitTelemetry();
  }

  /**
   * Parses Tacx FE-C over BLE RX notification stream.
   */
  private handleTacxFecRx(dataView: DataView): void {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);

    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0xa4 && i + 3 < bytes.length) {
        const len = bytes[i + 1];
        const payloadStart = i + 4;
        if (payloadStart + len <= bytes.length) {
          const payload = bytes.subarray(payloadStart, payloadStart + len);
          if (payload.length > 0) {
            const dataPage = payload[0];
            if (dataPage === 0x19 && payload.length >= 7) {
              // Page 0x19 (25): Specific Trainer Data
              if (payload[2] < 254) {
                this.currentCadenceRpm = payload[2];
              }
              this.currentPowerWatts = payload[5] | ((payload[6] & 0x0f) << 8);
              this.hasTacxPower = true;
              this.emitTelemetry();
            } else if (dataPage === 0x10 && payload.length >= 7) {
              // Page 0x10 (16): General FE Data
              const speedRaw = payload[4] | (payload[5] << 8);
              const speedMps = speedRaw / 1000;
              this.currentSpeedKmh = speedMps * 3.6;
              if (payload[6] < 255 && payload[6] > 0) {
                this.currentHeartRateBpm = payload[6];
              }
              this.emitTelemetry();
            }
          }
        }
      }
    }
  }

  private async writeCharacteristic(char: BleRemoteGATTCharacteristic, data: Uint8Array): Promise<void> {
    try {
      if (char.writeValueWithoutResponse && char.properties.writeWithoutResponse) {
        await char.writeValueWithoutResponse(data);
      } else if (char.writeValueWithResponse && char.properties.write) {
        await char.writeValueWithResponse(data);
      } else {
        await char.writeValue(data);
      }
    } catch {
      try {
        await char.writeValue(data);
      } catch {
        // Ignore write failures to prevent unhandled rejections
      }
    }
  }

  private emitTelemetry(): void {
    const now = Date.now();
    if (this.lastTelemetryTime > 0) {
      const dt = (now - this.lastTelemetryTime) / 1000;
      if (dt > 0 && dt < 5) {
        this.currentDistanceMeters += (this.currentSpeedKmh / 3.6) * dt;
      }
    }
    this.lastTelemetryTime = now;

    const telemetry: TrainerTelemetry = {
      timestamp: now,
      powerWatts: Math.round(this.currentPowerWatts),
      targetWatts: Math.round(this.currentTargetWatts),
      cadenceRpm: Math.round(this.currentCadenceRpm),
      speedKmh: Number(this.currentSpeedKmh.toFixed(1)),
      distanceMeters: Math.round(this.currentDistanceMeters),
      heartRateBpm: this.currentHeartRateBpm > 0 ? this.currentHeartRateBpm : undefined
    };

    this.onTelemetryCb?.(telemetry);
  }
}

export const bleTrainer = new BleTrainerService();

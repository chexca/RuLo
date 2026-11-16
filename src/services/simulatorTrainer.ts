import type { TrainerTelemetry, TrainerStateEvent } from '../types/workout';

export class SimulatorTrainerService {
  private isConnected = false;
  private currentWatts = 0;
  private targetWatts = 0;
  private distanceMeters = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onTelemetryCb?: (t: TrainerTelemetry) => void;
  private onStateChangeCb?: (s: TrainerStateEvent) => void;

  /**
   * Connects to the virtual trainer simulator.
   * Emits telemetry updates every 500ms.
   */
  connect(
    onTelemetry: (t: TrainerTelemetry) => void,
    onStateChange: (s: TrainerStateEvent) => void
  ): void {
    this.onTelemetryCb = onTelemetry;
    this.onStateChangeCb = onStateChange;

    this.isConnected = true;
    this.currentWatts = 0;
    this.targetWatts = 0;
    this.distanceMeters = 0;

    onStateChange({
      transport: 'simulator',
      status: 'connected',
      deviceName: 'Simulador Virtual'
    });

    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      this.tick();
    }, 500);
  }

  /**
   * Sets the ERG target power for the virtual rider.
   */
  setTargetPower(watts: number): void {
    this.targetWatts = Math.max(0, Math.round(watts));
  }

  /**
   * Disconnects the simulator and stops the telemetry interval.
   */
  disconnect(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const wasConnected = this.isConnected;
    this.isConnected = false;
    this.currentWatts = 0;
    this.targetWatts = 0;

    if (wasConnected && this.onStateChangeCb) {
      this.onStateChangeCb({
        transport: 'simulator',
        status: 'disconnected',
        deviceName: 'Simulador Virtual'
      });
    }
  }

  private tick(): void {
    if (!this.isConnected) return;

    if (this.targetWatts > 0) {
      this.currentWatts += (this.targetWatts - this.currentWatts) * 0.35 + (Math.random() - 0.5) * 4;
      this.currentWatts = Math.max(0, this.currentWatts);
    } else {
      this.currentWatts += (0 - this.currentWatts) * 0.35;
      if (this.currentWatts < 3) this.currentWatts = 0;
    }

    const power = Math.max(0, this.currentWatts);

    let cadenceRpm = 0;
    if (this.targetWatts > 0 || power > 15) {
      cadenceRpm = Math.max(50, Math.min(130, Math.round(88 + (Math.random() - 0.5) * 4)));
    }

    let speedKmh = 0;
    if (power > 0) {
      speedKmh = Math.cbrt(power / 0.032) * 3.6;
    }

    // Accumulate distance for 0.5s interval
    this.distanceMeters += (speedKmh / 3.6) * 0.5;

    // Realistic indoor heart rate based on power
    let heartRateBpm: number | undefined;
    if (power > 20) {
      heartRateBpm = Math.round(115 + (power / 280) * 55 + (Math.random() - 0.5) * 2);
    } else {
      heartRateBpm = 80;
    }

    const telemetry: TrainerTelemetry = {
      timestamp: Date.now(),
      powerWatts: Math.round(power),
      targetWatts: this.targetWatts,
      cadenceRpm,
      speedKmh: Number(speedKmh.toFixed(1)),
      distanceMeters: Math.round(this.distanceMeters),
      heartRateBpm
    };

    this.onTelemetryCb?.(telemetry);
  }
}

export const simulatorTrainer = new SimulatorTrainerService();

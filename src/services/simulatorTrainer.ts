import type { TrainerTelemetry, TrainerStateEvent } from '../types/workout';

export const SIM_HR_EXPIRY_MS = 6000;
export const SIM_PEDAL_TIMEOUT_MS = 2500;

export class SimulatorTrainerService {
  private isConnected = false;
  private currentWatts = 0;
  private targetWatts = 0;
  private distanceMeters = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onTelemetryCb?: (t: TrainerTelemetry) => void;
  private onStateChangeCb?: (s: TrainerStateEvent) => void;

  // Fault-injection & resilience tracking for simulation/QA
  private packetsPaused = false;
  private pedalingStopped = false;
  private hrPaused = false;
  private hrOverrideBpm: number | null = null;
  private latestHrBpm: number | undefined = undefined;
  private latestHrTimestamp = 0;
  private lastFreshPedalTimestamp = 0;

  /**
   * Returns current HR BPM only if valid and received within the last 6000 ms.
   */
  public getValidHrBpm(now: number = Date.now()): number | undefined {
    if (this.latestHrBpm === undefined || this.latestHrTimestamp <= 0) {
      return undefined;
    }
    if (now - this.latestHrTimestamp > SIM_HR_EXPIRY_MS) {
      return undefined;
    }
    return this.latestHrBpm;
  }

  /**
   * Pauses or resumes all telemetry packet emissions (simulates complete radio silence).
   */
  public setPausePackets(paused: boolean): void {
    this.packetsPaused = paused;
  }

  /**
   * Simulates stopping pedaling (0 RPM) and resuming pedaling.
   */
  public setStopPedaling(stopped: boolean): void {
    this.pedalingStopped = stopped;
  }

  /**
   * Simulates HR strap dropout (when paused=true, stops updating HR timestamp so it expires after 6s).
   */
  public setPauseHr(paused: boolean, fixedBpmBeforeDropout?: number): void {
    if (paused && typeof fixedBpmBeforeDropout === 'number') {
      this.latestHrBpm = fixedBpmBeforeDropout;
      this.latestHrTimestamp = Date.now();
    }
    this.hrPaused = paused;
  }

  /**
   * Overrides simulated HR BPM (pass null to return to automatic power-based HR).
   */
  public setHrOverride(bpm: number | null): void {
    this.hrOverrideBpm = bpm;
    if (typeof bpm === 'number' && bpm > 0) {
      this.latestHrBpm = bpm;
      this.latestHrTimestamp = Date.now();
      this.hrPaused = false;
    }
  }

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
    this.packetsPaused = false;
    this.pedalingStopped = false;
    this.hrPaused = false;
    this.hrOverrideBpm = null;
    this.latestHrBpm = 80;
    this.latestHrTimestamp = Date.now();
    this.lastFreshPedalTimestamp = Date.now();

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
    this.packetsPaused = false;
    this.pedalingStopped = false;
    this.hrPaused = false;
    this.hrOverrideBpm = null;
    this.latestHrBpm = undefined;
    this.latestHrTimestamp = 0;

    if (wasConnected && this.onStateChangeCb) {
      this.onStateChangeCb({
        transport: 'simulator',
        status: 'disconnected',
        deviceName: 'Simulador Virtual'
      });
    }
  }

  private tick(): void {
    if (!this.isConnected || this.packetsPaused) return;
    const now = Date.now();

    if (this.pedalingStopped) {
      this.currentWatts = 0;
    } else if (this.targetWatts > 0) {
      this.currentWatts += (this.targetWatts - this.currentWatts) * 0.35 + (Math.random() - 0.5) * 4;
      this.currentWatts = Math.max(0, this.currentWatts);
      this.lastFreshPedalTimestamp = now;
    } else {
      this.currentWatts += (0 - this.currentWatts) * 0.35;
      if (this.currentWatts < 3) this.currentWatts = 0;
      if (this.currentWatts > 0) {
        this.lastFreshPedalTimestamp = now;
      }
    }

    const pedalingTimedOut =
      this.pedalingStopped && now - this.lastFreshPedalTimestamp > SIM_PEDAL_TIMEOUT_MS;
    const power = pedalingTimedOut || this.pedalingStopped ? 0 : Math.max(0, this.currentWatts);

    let cadenceRpm = 0;
    if (!this.pedalingStopped && (this.targetWatts > 0 || power > 15)) {
      cadenceRpm = Math.max(50, Math.min(130, Math.round(88 + (Math.random() - 0.5) * 4)));
    }

    let speedKmh = 0;
    if (power > 0) {
      speedKmh = Math.cbrt(power / 0.032) * 3.6;
    }

    // Accumulate distance for 0.5s interval
    this.distanceMeters += (speedKmh / 3.6) * 0.5;

    // Realistic indoor heart rate based on power (with 6s expiry if HR signal is paused)
    if (!this.hrPaused) {
      if (this.hrOverrideBpm !== null) {
        this.latestHrBpm = this.hrOverrideBpm;
      } else if (power > 20) {
        this.latestHrBpm = Math.round(115 + (power / 280) * 55 + (Math.random() - 0.5) * 2);
      } else {
        this.latestHrBpm = 80;
      }
      this.latestHrTimestamp = now;
    }

    const heartRateBpm = this.getValidHrBpm(now);

    const telemetry: TrainerTelemetry = {
      timestamp: now,
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

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ruloSimulatorTrainer = simulatorTrainer;
}

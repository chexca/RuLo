import React, { useState } from 'react';
import {
  Radio,
  Bluetooth,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Zap,
  Unlink,
  Info,
} from 'lucide-react';
import {
  ConnectionTransport,
  ConnectionStatus,
  DiscoveredDevice,
} from '../types/workout';

export interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTransport: ConnectionTransport;
  connectionStatus: ConnectionStatus;
  deviceName?: string;
  stickName?: string;
  errorMessage?: string;
  discoveredAntDevices: DiscoveredDevice[];
  discoveredBleDevices: { deviceId: string; deviceName: string }[];
  onStartAntScan: () => void;
  onConnectAntDevice: (deviceId: number) => void;
  onConnectBle: () => void;
  onSelectBleDevice: (deviceId: string) => void;
  onConnectSimulator: () => void;
  onDisconnect: () => void;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  activeTransport,
  connectionStatus,
  deviceName,
  stickName,
  errorMessage,
  discoveredAntDevices,
  discoveredBleDevices,
  onStartAntScan,
  onConnectAntDevice,
  onConnectBle,
  onSelectBleDevice,
  onConnectSimulator,
  onDisconnect,
}) => {
  const [activeTab, setActiveTab] = useState<'ant' | 'ble' | 'simulator'>('ant');

  if (!isOpen) return null;

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';
  const isScanning = connectionStatus === 'scanning';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '640px', maxWidth: '95vw' }}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Radio className="text-cyan-400" size={22} style={{ color: 'var(--accent-cyan)' }} />
            <span>Conectar Rodillo Tacx Neo 2</span>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Global Connection Status Banner if connected */}
        {isConnected && (
          <div
            style={{
              padding: '12px 24px',
              background: 'rgba(16, 185, 129, 0.1)',
              borderBottom: '1px solid rgba(16, 185, 129, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={18} style={{ color: 'var(--accent-emerald)' }} />
              <span style={{ fontSize: '0.9rem', color: '#ecfdf5', fontWeight: 600 }}>
                Conectado:{' '}
                <span style={{ color: 'var(--accent-emerald)' }}>
                  {deviceName || 'Tacx Neo 2'}
                </span>{' '}
                ({activeTransport === 'ant' ? 'ANT+ FE-C' : activeTransport === 'ble' ? 'Bluetooth FTMS' : 'Simulador'})
              </span>
            </div>
            <button
              className="btn btn-danger"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              onClick={onDisconnect}
            >
              <Unlink size={14} /> Desconectar
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="modal-body">
          {/* Navigation Tabs */}
          <div className="tabs-nav">
            <button
              className={`tab-btn ${activeTab === 'ant' ? 'active' : ''}`}
              onClick={() => setActiveTab('ant')}
            >
              <Radio size={16} /> ANT+ USB (Recomendado)
            </button>
            <button
              className={`tab-btn ${activeTab === 'ble' ? 'active' : ''}`}
              onClick={() => setActiveTab('ble')}
            >
              <Bluetooth size={16} /> Bluetooth
            </button>
            <button
              className={`tab-btn ${activeTab === 'simulator' ? 'active' : ''}`}
              onClick={() => setActiveTab('simulator')}
            >
              <Cpu size={16} /> Simulador Virtual
            </button>
          </div>

          {/* TAB 1: ANT+ USB */}
          {activeTab === 'ant' && (
            <div>
              {errorMessage && (
                <div className="alert-box alert-amber">
                  <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>Aviso de conexión ANT+</div>
                    <div>{errorMessage}</div>
                    <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#fbbf24' }}>
                      💡 Tip: Si tienes <em>Garmin Express</em> abierto, ciérralo por completo desde la bandeja del sistema (suele acaparar el pincho USB ANT+).
                    </div>
                  </div>
                </div>
              )}

              <div
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.95rem' }}>
                      Antena ANT+ USB
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {stickName || 'Pincho USB ANT+ (CyUSB / LibUsb / Garmin ANT2)'}
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '0.82rem' }}
                    onClick={onStartAntScan}
                    disabled={isScanning || isConnecting}
                  >
                    <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                    {isScanning ? 'Escaneando...' : 'Escanear Canal'}
                  </button>
                </div>

                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  ANT+ FE-C es el protocolo más robusto y sin latencia para el Tacx Neo 2. No requiere emparejamiento previo en Windows.
                </p>
              </div>

              {/* Direct wildcard connect button */}
              <div style={{ marginBottom: '20px' }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px 18px', fontSize: '0.95rem', fontWeight: 700 }}
                  onClick={() => onConnectAntDevice(0)}
                  disabled={isConnecting}
                >
                  <Zap size={18} />
                  {isConnecting && activeTransport === 'ant'
                    ? 'Conectando con Tacx Neo 2...'
                    : 'Conectar directo al rodillo cercano (Auto FE-C)'}
                </button>
                <div style={{ textAlign: 'center', marginTop: 6, fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  Enlaza de inmediato con cualquier rodillo ANT+ FE-C encendido cerca.
                </div>
              </div>

              {/* Discovered ANT+ Devices List */}
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Dispositivos FE-C detectados ({discoveredAntDevices.length})
                </div>

                {discoveredAntDevices.length === 0 ? (
                  <div
                    style={{
                      padding: '20px',
                      background: 'rgba(15, 23, 42, 0.5)',
                      borderRadius: '8px',
                      border: '1px dashed var(--border-subtle)',
                      textAlign: 'center',
                      fontSize: '0.85rem',
                      color: 'var(--text-dim)',
                    }}
                  >
                    {isScanning
                      ? 'Buscando señales ANT+ FE-C... Pedalea un par de vueltas para despertar el Tacx Neo 2.'
                      : 'Pulsa "Escanear Canal" o usa "Conectar directo al rodillo cercano".'}
                  </div>
                ) : (
                  <div>
                    {discoveredAntDevices.map((dev) => (
                      <div key={dev.id || dev.antDeviceId} className="device-item">
                        <div>
                          <div style={{ fontWeight: 600, color: '#f8fafc' }}>
                            {dev.name || `Rodillo FE-C (ID: ${dev.antDeviceId})`}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            ID ANT: {dev.antDeviceId} {dev.rssi ? `· Señal: ${dev.rssi} dBm` : ''}
                          </div>
                        </div>
                        <button
                          className="btn btn-emerald"
                          style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                          onClick={() => onConnectAntDevice(dev.antDeviceId || 0)}
                          disabled={isConnecting}
                        >
                          Conectar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: BLUETOOTH */}
          {activeTab === 'ble' && (
            <div>
              <div
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.95rem', marginBottom: 4 }}>
                  Bluetooth Low Energy (FTMS / Tacx Smart)
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Conecta tu Tacx Neo 2 mediante el estándar FTMS (Fitness Machine Service) o Tacx BLE. Asegúrate de que no esté emparejado a tu móvil o a Rouvy simultáneamente.
                </p>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px' }}
                  onClick={onConnectBle}
                  disabled={isConnecting}
                >
                  <Bluetooth size={18} />
                  {isConnecting && activeTransport === 'ble'
                    ? 'Buscando dispositivos Bluetooth...'
                    : 'Buscar Tacx Neo 2 por Bluetooth'}
                </button>
              </div>

              {/* Discovered BLE devices list */}
              {discoveredBleDevices.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Dispositivos Bluetooth encontrados
                  </div>
                  {discoveredBleDevices.map((d) => (
                    <div key={d.deviceId} className="device-item">
                      <div>
                        <div style={{ fontWeight: 600, color: '#f8fafc' }}>
                          {d.deviceName || 'Tacx Trainer'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          ID: {d.deviceId}
                        </div>
                      </div>
                      <button
                        className="btn btn-emerald"
                        style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                        onClick={() => onSelectBleDevice(d.deviceId)}
                      >
                        Conectar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SIMULADOR VIRTUAL */}
          {activeTab === 'simulator' && (
            <div>
              <div
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Cpu size={24} style={{ color: 'var(--accent-cyan)' }} />
                  <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '1.05rem' }}>
                    Rodillo Simulado Integrado
                  </div>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
                  Simula la respuesta del Tacx Neo 2 en modo ERG: genera telemetría de vatios con variaciones realistas en torno al objetivo, cadencia estable (~90 RPM) y velocidad calculada.
                </p>

                <div
                  style={{
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '0.8rem',
                    color: '#bae6fd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Info size={16} style={{ flexShrink: 0 }} />
                  Ideal para probar planes de entrenamiento, rampas, beeps de cuenta atrás y exportación de archivos TCX/FIT en tu escritorio.
                </div>
              </div>

              <button
                className="btn btn-emerald"
                style={{ width: '100%', padding: '14px', fontSize: '1rem', fontWeight: 700 }}
                onClick={() => {
                  onConnectSimulator();
                  onClose();
                }}
              >
                <Zap size={18} /> Activar Rodillo Simulado
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

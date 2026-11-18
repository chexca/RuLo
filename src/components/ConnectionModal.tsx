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
  Heart,
  Battery,
} from 'lucide-react';
import {
  ConnectionTransport,
  ConnectionStatus,
  DiscoveredDevice,
} from '../types/workout';
import { NumericInput } from './NumericInput';
import { useI18n } from '../i18n';

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

  // ANT+ HR Sensor Props
  hrStatus?: ConnectionStatus;
  hrDeviceName?: string;
  hrDeviceId?: number;
  hrBpm?: number;
  hrBatteryStatus?: string;
  hrErrorMessage?: string;
  onConnectAntHr?: (deviceId: number) => void;
  onDisconnectAntHr?: () => void;
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
  hrStatus = 'disconnected',
  hrDeviceName,
  hrDeviceId,
  hrBpm,
  hrBatteryStatus,
  hrErrorMessage,
  onConnectAntHr,
  onDisconnectAntHr,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'ant' | 'ble' | 'simulator'>('ant');
  const [customHrId, setCustomHrId] = useState<number | undefined>(undefined);

  if (!isOpen) return null;

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';
  const isScanning = connectionStatus === 'scanning';

  const isHrConnected = hrStatus === 'connected';
  const isHrConnecting = hrStatus === 'connecting';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '660px', maxWidth: '95vw', maxHeight: '92vh' }}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            <Radio className="text-cyan-400" size={22} style={{ color: 'var(--accent-cyan)' }} />
            <span>{t('conn.title')}</span>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label={t('conn.close')}
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
                {t('conn.trainerConnected')}{' '}
                <span style={{ color: 'var(--accent-emerald)' }}>
                  {deviceName || 'Tacx Neo 2'}
                </span>{' '}
                ({activeTransport === 'ant' ? 'ANT+ FE-C' : activeTransport === 'ble' ? 'Bluetooth FTMS' : t('conn.transportSim')})
              </span>
            </div>
            <button
              className="btn btn-danger"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              onClick={onDisconnect}
            >
              <Unlink size={14} /> {t('conn.disconnectTrainer')}
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="modal-body">
          {/* SECTION 1: TRAINER SELECTION */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc', marginBottom: 12 }}>
              {t('conn.section1Title')}
            </div>

            {/* Navigation Tabs */}
            <div className="tabs-nav">
              <button
                className={`tab-btn ${activeTab === 'ant' ? 'active' : ''}`}
                onClick={() => setActiveTab('ant')}
              >
                <Radio size={16} /> {t('conn.tabAnt')}
              </button>
              <button
                className={`tab-btn ${activeTab === 'ble' ? 'active' : ''}`}
                onClick={() => setActiveTab('ble')}
              >
                <Bluetooth size={16} /> {t('conn.tabBle')}
              </button>
              <button
                className={`tab-btn ${activeTab === 'simulator' ? 'active' : ''}`}
                onClick={() => setActiveTab('simulator')}
              >
                <Cpu size={16} /> {t('conn.tabSim')}
              </button>
            </div>

            {/* TAB 1: ANT+ USB */}
            {activeTab === 'ant' && (
              <div>
                {errorMessage && (
                  <div className="alert-box alert-amber">
                    <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>{t('conn.antNoticeTitle')}</div>
                      <div>{errorMessage}</div>
                      <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#fbbf24' }}>
                        {t('conn.antTipBefore')}<em>Garmin Express</em>{t('conn.antTipAfter')}
                      </div>
                    </div>
                  </div>
                )}

                <div
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    marginBottom: '14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.9rem' }}>
                        {t('conn.antStickTitle')}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {stickName || t('conn.antStickDefault')}
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '5px 12px', fontSize: '0.8rem' }}
                      onClick={onStartAntScan}
                      disabled={isScanning || isConnecting}
                    >
                      <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                      {isScanning ? t('conn.scanning') : t('conn.scanChannel')}
                    </button>
                  </div>

                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {t('conn.antDesc')}
                  </p>
                </div>

                {/* Direct wildcard connect button */}
                <div style={{ marginBottom: '16px' }}>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '11px 16px', fontSize: '0.92rem', fontWeight: 700 }}
                    onClick={() => onConnectAntDevice(0)}
                    disabled={isConnecting}
                  >
                    <Zap size={17} />
                    {isConnecting && activeTransport === 'ant'
                      ? t('conn.connectingTrainer')
                      : t('conn.connectAutoFec')}
                  </button>
                  <div style={{ textAlign: 'center', marginTop: 5, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {t('conn.connectAutoFecHint')}
                  </div>
                </div>

                {/* Discovered ANT+ Devices List */}
                {discoveredAntDevices.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {t('conn.antDetected', { count: discoveredAntDevices.length })}
                    </div>
                    {discoveredAntDevices.map((dev) => (
                      <div key={dev.id || dev.antDeviceId} className="device-item">
                        <div>
                          <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.88rem' }}>
                            {dev.name || t('conn.antDeviceFallback', { id: dev.antDeviceId ?? '' })}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {t('conn.antIdLabel')} {dev.antDeviceId}{' '}
                            {dev.rssi ? t('conn.signalLabel', { rssi: dev.rssi }) : ''}
                          </div>
                        </div>
                        <button
                          className="btn btn-emerald"
                          style={{ padding: '5px 12px', fontSize: '0.8rem' }}
                          onClick={() => onConnectAntDevice(dev.antDeviceId || 0)}
                          disabled={isConnecting}
                        >
                          {t('conn.connect')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                    padding: '14px 16px',
                    marginBottom: '14px',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.9rem', marginBottom: 4 }}>
                    {t('conn.bleTitle')}
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {t('conn.bleDesc')}
                  </p>
                </div>

                <div style={{ marginBottom: '14px' }}>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '11px' }}
                    onClick={onConnectBle}
                    disabled={isConnecting}
                  >
                    <Bluetooth size={17} />
                    {isConnecting && activeTransport === 'ble'
                      ? t('conn.bleSearching')
                      : t('conn.bleSearchBtn')}
                  </button>
                </div>

                {discoveredBleDevices.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {t('conn.bleFoundTitle')}
                    </div>
                    {discoveredBleDevices.map((d) => (
                      <div key={d.deviceId} className="device-item">
                        <div>
                          <div style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.88rem' }}>
                            {d.deviceName || 'Tacx Trainer'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            ID: {d.deviceId}
                          </div>
                        </div>
                        <button
                          className="btn btn-emerald"
                          style={{ padding: '5px 12px', fontSize: '0.8rem' }}
                          onClick={() => onSelectBleDevice(d.deviceId)}
                        >
                          {t('conn.connect')}
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
                    padding: '16px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <Cpu size={22} style={{ color: 'var(--accent-cyan)' }} />
                    <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '1rem' }}>
                      {t('conn.simTitle')}
                    </div>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 12 }}>
                    {t('conn.simDesc')}
                  </p>
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.2)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      fontSize: '0.78rem',
                      color: '#bae6fd',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Info size={15} style={{ flexShrink: 0 }} />
                    {t('conn.simHint')}
                  </div>
                </div>

                <button
                  className="btn btn-emerald"
                  style={{ width: '100%', padding: '12px', fontSize: '0.95rem', fontWeight: 700 }}
                  onClick={() => {
                    onConnectSimulator();
                    onClose();
                  }}
                >
                  <Zap size={17} /> {t('conn.simActivateBtn')}
                </button>
              </div>
            )}
          </div>

          {/* SECTION 2: HEART RATE STRAP (ANT+ PARALLEL CHANNEL 1) */}
          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              marginTop: '22px',
              paddingTop: '18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Heart size={20} style={{ color: '#ef4444' }} />
                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc' }}>
                  {t('conn.section2Title')}
                </span>
              </div>
              {isHrConnected && (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#f87171',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                  }}
                >
                  <Heart size={12} fill="currentColor" className="animate-pulse" />
                  {hrBpm ? `${hrBpm} ${t('conn.bpmUnit')}` : t('conn.connected')}
                </span>
              )}
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 12 }}>
              {t('conn.hrDesc')}
            </p>

            {hrErrorMessage && (
              <div className="alert-box alert-amber" style={{ padding: '10px 12px', marginBottom: 12 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: '0.82rem' }}>{hrErrorMessage}</div>
              </div>
            )}

            {isHrConnected ? (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '10px',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#fecaca' }}>
                    <Heart size={16} fill="#ef4444" color="#ef4444" />
                    <span>{hrDeviceName || t('conn.hrDefaultName')}</span>
                    {hrDeviceId && hrDeviceId > 0 && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        (ID: {hrDeviceId})
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#fca5a5', marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <strong>{hrBpm ? `${hrBpm} ${t('conn.bpmUnit')}` : t('conn.hrWaiting')}</strong>
                    {hrBatteryStatus && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
                        <Battery size={13} /> {hrBatteryStatus}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  className="btn btn-danger"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => onDisconnectAntHr?.()}
                >
                  <Unlink size={14} /> {t('conn.disconnectHr')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1, padding: '10px 14px', fontSize: '0.88rem', fontWeight: 700 }}
                    onClick={() => onConnectAntHr?.(0)}
                    disabled={isHrConnecting}
                  >
                    <Heart size={16} />
                    {isHrConnecting
                      ? t('conn.hrSearching')
                      : t('conn.hrPairAuto')}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                  <NumericInput
                    allowEmpty
                    min={1}
                    placeholder={t('conn.hrCustomIdPlaceholder')}
                    className="input-number"
                    style={{ flex: 1, padding: '7px 10px', fontSize: '0.82rem' }}
                    value={customHrId}
                    onChangeOptional={setCustomHrId}
                  />
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '7px 14px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                    onClick={() => {
                      if (customHrId && customHrId > 0) onConnectAntHr?.(customHrId);
                    }}
                    disabled={!customHrId || customHrId <= 0 || isHrConnecting}
                  >
                    {t('conn.hrConnectById')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('conn.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

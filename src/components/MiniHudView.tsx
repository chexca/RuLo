import React, { useEffect, useState } from 'react';
import { Heart, Gauge, Play, Pause, X, GripVertical } from 'lucide-react';
import { MiniHudData, MiniHudCommand } from '../types/workout';
import { formatTime } from '../utils/workoutMath';
import { useI18n } from '../i18n';

export const MiniHudView: React.FC = () => {
  const { t, lang, setLang } = useI18n();
  const [data, setData] = useState<MiniHudData | null>(null);

  useEffect(() => {
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    const prevBodyOverflow = document.body.style.overflow;

    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onMiniHudData) return;
    const unsub = window.electronAPI.onMiniHudData((incoming) => {
      setData(incoming);
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (data?.lang && data.lang !== lang) {
      setLang(data.lang);
    }
  }, [data?.lang, lang, setLang]);

  const sendCommand = (cmd: MiniHudCommand) => {
    if (cmd.type === 'close') {
      window.electronAPI?.sendMiniHudCommand?.(cmd);
      void window.electronAPI?.closeMiniHud?.();
      return;
    }
    window.electronAPI?.sendMiniHudCommand?.(cmd);
  };

  if (!data) {
    return (
      <div className="mini-hud-shell">
        <div className="mini-hud-card mini-hud-waiting">
          <div className="mini-hud-grip" title={t('minihud.dragTitle')}>
            <GripVertical size={15} />
          </div>
          <span className="mini-hud-waiting-text">{t('minihud.waiting')}</span>
          <button
            type="button"
            className="mini-hud-btn mini-hud-btn-close"
            onClick={() => sendCommand({ type: 'close' })}
            title={t('minihud.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  const isWorkout = data.mode === 'workout';
  const timeSeconds =
    isWorkout && typeof data.remainingSec === 'number'
      ? data.remainingSec
      : data.elapsedSec;
  const timeLabel =
    isWorkout && typeof data.remainingSec === 'number'
      ? t('minihud.remaining')
      : t('minihud.elapsed');

  const zoneColor = data.zoneColor || '#0ea5e9';
  const hrValue =
    typeof data.heartRateBpm === 'number' && data.heartRateBpm > 0
      ? Math.round(data.heartRateBpm)
      : '--';
  const cadValue =
    typeof data.cadenceRpm === 'number' && data.cadenceRpm > 0
      ? Math.round(data.cadenceRpm)
      : '--';

  return (
    <div className="mini-hud-shell">
      <div
        className="mini-hud-card"
        style={{
          borderColor: `${zoneColor}55`,
          boxShadow: `0 10px 28px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 0 16px ${zoneColor}22`,
        }}
      >
        {/* Drag Handle */}
        <div className="mini-hud-grip" title={t('minihud.dragTitle')}>
          <GripVertical size={15} />
        </div>

        {/* Primary Power + Target & Zone Pill */}
        <div className="mini-hud-power-block">
          <div className="mini-hud-power-main">
            <span className="mini-hud-watts">{Math.round(data.powerWatts)}</span>
            <span className="mini-hud-watts-unit">W</span>
          </div>
          <div className="mini-hud-target-row">
            {data.ergEnabled && data.targetWatts !== null ? (
              <span className="mini-hud-target-text">
                {t('minihud.target')} <strong>{Math.round(data.targetWatts)}W</strong>
              </span>
            ) : (
              <span className="mini-hud-target-text">
                {t('minihud.freeMode')}
                {typeof data.resistancePct === 'number' ? ` ${data.resistancePct}%` : ''}
              </span>
            )}
            {data.zoneCode && (
              <span
                className="mini-hud-zone-pill"
                style={{
                  backgroundColor: `${zoneColor}26`,
                  color: zoneColor,
                  borderColor: `${zoneColor}66`,
                }}
              >
                {data.zoneCode}
              </span>
            )}
          </div>
        </div>

        <div className="mini-hud-divider" />

        {/* Secondary Metrics: HR, Cadence, Timer */}
        <div className="mini-hud-metrics">
          <div className="mini-hud-metric" title={t('player.heartRate')}>
            <Heart size={13} className="mini-hud-icon-hr" />
            <span className="mini-hud-metric-val">{hrValue}</span>
            <span className="mini-hud-metric-unit">{t('player.bpmUnit')}</span>
          </div>

          <div className="mini-hud-metric" title={t('player.cadence')}>
            <Gauge size={13} className="mini-hud-icon-cad" />
            <span className="mini-hud-metric-val">{cadValue}</span>
            <span className="mini-hud-metric-unit">rpm</span>
          </div>

          <div className="mini-hud-timer">
            <span className="mini-hud-timer-label">
              {data.blockName ? data.blockName : timeLabel}
            </span>
            <span
              className={`mini-hud-timer-val ${
                data.hideClock ? 'mini-hud-timer-blurred' : ''
              }`}
            >
              {formatTime(Math.max(0, Math.floor(timeSeconds)))}
            </span>
          </div>
        </div>

        <div className="mini-hud-divider" />

        {/* Quick Action Buttons (no-drag) */}
        <div className="mini-hud-actions">
          <button
            type="button"
            className="mini-hud-btn mini-hud-btn-step"
            onClick={() => sendCommand({ type: 'wattsDelta', delta: -10 })}
            title={t('minihud.minus10Title')}
          >
            {t('minihud.minus10')}
          </button>
          <button
            type="button"
            className="mini-hud-btn mini-hud-btn-step"
            onClick={() => sendCommand({ type: 'wattsDelta', delta: 10 })}
            title={t('minihud.plus10Title')}
          >
            {t('minihud.plus10')}
          </button>
          <button
            type="button"
            className={`mini-hud-btn mini-hud-btn-play ${
              data.isPlaying ? 'is-playing' : 'is-paused'
            }`}
            onClick={() => sendCommand({ type: 'togglePause' })}
            title={data.isPlaying ? t('minihud.pause') : t('minihud.resume')}
          >
            {data.isPlaying ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            type="button"
            className="mini-hud-btn mini-hud-btn-close"
            onClick={() => sendCommand({ type: 'close' })}
            title={t('minihud.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

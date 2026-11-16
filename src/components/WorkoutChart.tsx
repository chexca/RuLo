import React, { useState, useId } from 'react';
import { Workout, WorkoutBlock, RecordedSample } from '../types/workout';
import { getPowerZone, resolveWatts, formatTime } from '../utils/workoutMath';

export interface WorkoutChartProps {
  workout: Workout;
  ftp: number;
  elapsedSec?: number;
  recordedSamples?: RecordedSample[];
  activeBlockIndex?: number;
  onSeekBlock?: (blockIndex: number) => void;
  height?: number;
  interactive?: boolean;
  showFtpLine?: boolean;
  className?: string;
}

interface TooltipData {
  blockIndex: number;
  block: WorkoutBlock;
  startSec: number;
  startWatts: number;
  endWatts: number;
  clientX: number;
  clientY: number;
}

export const WorkoutChart: React.FC<WorkoutChartProps> = ({
  workout,
  ftp,
  elapsedSec,
  recordedSamples,
  activeBlockIndex,
  onSeekBlock,
  height = 180,
  interactive = true,
  showFtpLine = true,
  className = '',
}) => {
  const chartId = useId();
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const blocks = workout.blocks || [];
  const totalDurationSec = blocks.reduce((acc, b) => acc + (b.durationSec || 0), 0);

  if (totalDurationSec <= 0 || blocks.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-center p-6 text-slate-500 border border-dashed border-slate-800 rounded-lg ${className}`}
        style={{ height }}
      >
        <span style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          No hay bloques definidos para graficar
        </span>
      </div>
    );
  }

  const viewBoxWidth = 1000;
  const viewBoxHeight = height;
  const padTop = 16;
  const padBottom = 22;
  const chartHeight = Math.max(viewBoxHeight - padTop - padBottom, 40);

  // Calculate max watts across blocks and recorded samples for scale
  let maxW = ftp * 1.15;
  for (const b of blocks) {
    const sW = resolveWatts(b.powerStart, b.unit, ftp);
    const eW = b.type === 'ramp' ? resolveWatts(b.powerEnd, b.unit, ftp) : sW;
    if (sW > maxW) maxW = sW;
    if (eW > maxW) maxW = eW;
  }
  if (recordedSamples) {
    for (const s of recordedSamples) {
      if (s.powerWatts > maxW) maxW = s.powerWatts;
    }
  }
  const maxScaleWatts = Math.max(Math.ceil((maxW * 1.15) / 20) * 20, 200);

  const getY = (watts: number) => {
    const clamped = Math.min(Math.max(watts, 0), maxScaleWatts);
    return padTop + chartHeight * (1 - clamped / maxScaleWatts);
  };

  const getX = (sec: number) => {
    return (Math.min(Math.max(sec, 0), totalDurationSec) / totalDurationSec) * viewBoxWidth;
  };

  const yFtp = getY(ftp);
  const yBottom = padTop + chartHeight;

  // Render blocks
  let cumulativeSec = 0;
  const renderedBlocks = blocks.map((block, index) => {
    const startSec = cumulativeSec;
    const duration = block.durationSec;
    const endSec = startSec + duration;
    cumulativeSec = endSec;

    const x1 = getX(startSec);
    const x2 = getX(endSec);
    const w = Math.max(x2 - x1, 0.5);

    const startWatts = resolveWatts(block.powerStart, block.unit, ftp);
    const endWatts = block.type === 'ramp' ? resolveWatts(block.powerEnd, block.unit, ftp) : startWatts;
    const midWatts = (startWatts + endWatts) / 2;
    const zone = getPowerZone(midWatts, ftp);

    const isActive = activeBlockIndex === index;
    const isCompleted = elapsedSec !== undefined && elapsedSec >= endSec;
    const isPastCurrent = elapsedSec !== undefined && elapsedSec < startSec;

    const yStart = getY(startWatts);
    const yEnd = getY(endWatts);

    // Opacity & visual emphasis
    let fillOpacity = 0.85;
    if (elapsedSec !== undefined) {
      if (isActive) {
        fillOpacity = 0.95;
      } else if (isCompleted) {
        fillOpacity = 0.35;
      } else {
        fillOpacity = 0.7;
      }
    }

    const strokeColor = isActive ? '#38bdf8' : zone.color;
    const strokeWidth = isActive ? 2 : 0.75;

    const handleMouseEnter = (e: React.MouseEvent) => {
      if (!interactive) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({
        blockIndex: index,
        block,
        startSec,
        startWatts,
        endWatts,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top - 10,
      });
    };

    const handleMouseLeave = () => {
      if (!interactive) return;
      setTooltip(null);
    };

    const handleClick = () => {
      if (onSeekBlock) {
        onSeekBlock(index);
      }
    };

    return (
      <g
        key={block.id || `b-${index}`}
        className="transition-all duration-200"
        style={{ cursor: onSeekBlock ? 'pointer' : interactive ? 'help' : 'default' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        {block.type === 'steady' ? (
          <rect
            x={x1}
            y={yStart}
            width={w}
            height={Math.max(yBottom - yStart, 1)}
            fill={zone.color}
            fillOpacity={fillOpacity}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            rx={w > 6 ? 2 : 0}
          />
        ) : (
          <polygon
            points={`${x1},${yBottom} ${x1},${yStart} ${x2},${yEnd} ${x2},${yBottom}`}
            fill={zone.color}
            fillOpacity={fillOpacity}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        )}

        {/* Highlight ring for active block */}
        {isActive && (
          <rect
            x={x1}
            y={Math.min(yStart, yEnd)}
            width={w}
            height={Math.max(yBottom - Math.min(yStart, yEnd), 1)}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={2.5}
            strokeDasharray="4 2"
            rx={2}
          />
        )}

        {/* Cadence target badge inside block if wide enough */}
        {block.cadenceTarget && w > 45 && (
          <text
            x={x1 + w / 2}
            y={yBottom - 6}
            fill="#ffffff"
            opacity={0.7}
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
          >
            {block.cadenceTarget} rpm
          </text>
        )}
      </g>
    );
  });

  // Recorded actual power line
  let polylinePoints = '';
  if (recordedSamples && recordedSamples.length > 0) {
    polylinePoints = recordedSamples
      .map((s) => `${getX(s.elapsedSec).toFixed(1)},${getY(s.powerWatts).toFixed(1)}`)
      .join(' ');
  }

  // Playhead position
  const xPlayhead = elapsedSec !== undefined ? getX(elapsedSec) : null;

  return (
    <div className={`relative w-full ${className}`} style={{ userSelect: 'none' }}>
      <svg
        viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
        className="w-full h-auto block overflow-visible"
        style={{ maxHeight: height }}
        preserveAspectRatio="none"
      >
        <defs>
          <filter id={`glow-${chartId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Baseline */}
        <line
          x1={0}
          y1={yBottom}
          x2={viewBoxWidth}
          y2={yBottom}
          stroke="#1e293b"
          strokeWidth={1.5}
        />

        {/* 100% FTP Reference line */}
        {showFtpLine && (
          <g>
            <line
              x1={0}
              y1={yFtp}
              x2={viewBoxWidth}
              y2={yFtp}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              strokeWidth={1.2}
            />
            <text
              x={viewBoxWidth - 6}
              y={yFtp - 4}
              fill="#f59e0b"
              fontSize="10"
              fontWeight="600"
              textAnchor="end"
              opacity={0.85}
            >
              {Math.round(ftp)} W (100% FTP)
            </text>
          </g>
        )}

        {/* Workout Blocks */}
        {renderedBlocks}

        {/* Actual Telemetry Line */}
        {polylinePoints && (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#22d3ee"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: `url(#glow-${chartId})` }}
          />
        )}

        {/* Vertical Playhead Cursor */}
        {xPlayhead !== null && (
          <g>
            <line
              x1={xPlayhead}
              y1={padTop}
              x2={xPlayhead}
              y2={yBottom}
              stroke="#38bdf8"
              strokeWidth={2.5}
              style={{ filter: 'drop-shadow(0 0 6px #38bdf8)' }}
            />
            <circle
              cx={xPlayhead}
              cy={padTop + 2}
              r={4}
              fill="#38bdf8"
              stroke="#ffffff"
              strokeWidth={1.5}
            />
          </g>
        )}

        {/* Duration bottom markers */}
        <text
          x={4}
          y={viewBoxHeight - 4}
          fill="#64748b"
          fontSize="10"
          fontWeight="500"
          textAnchor="start"
        >
          0:00
        </text>
        <text
          x={viewBoxWidth - 4}
          y={viewBoxHeight - 4}
          fill="#64748b"
          fontSize="10"
          fontWeight="500"
          textAnchor="end"
        >
          {formatTime(totalDurationSec)}
        </text>
      </svg>

      {/* Floating Hover Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: `${tooltip.clientX}px`,
            top: `${tooltip.clientY}px`,
            transform: 'translate(-50%, -100%)',
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '8px 12px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
            zIndex: 9999,
            fontSize: '0.8rem',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
            Bloque {tooltip.blockIndex + 1}: {tooltip.block.label || (tooltip.block.type === 'ramp' ? 'Rampa' : 'Fijo')}
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
            Duración: <strong style={{ color: '#e2e8f0' }}>{formatTime(tooltip.block.durationSec)}</strong>
            {' · '}
            Inicio: <span style={{ color: '#94a3b8' }}>{formatTime(tooltip.startSec)}</span>
          </div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            {tooltip.block.type === 'steady' ? (
              <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                {Math.round(tooltip.startWatts)} W ({Math.round((tooltip.startWatts / ftp) * 100)}% FTP)
              </span>
            ) : (
              <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                {Math.round(tooltip.startWatts)} W → {Math.round(tooltip.endWatts)} W
              </span>
            )}
            {tooltip.block.cadenceTarget && (
              <span style={{ color: '#a78bfa' }}>
                · {tooltip.block.cadenceTarget} RPM
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

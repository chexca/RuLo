import React, { useState, useId } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Layers,
  TrendingUp,
  Activity,
  Save,
  X,
  Download,
  Upload,
  Clock,
  Zap,
  Flame,
} from 'lucide-react';
import { Workout, WorkoutBlock, PowerUnit, BlockType } from '../types/workout';
import { WorkoutChart } from './WorkoutChart';
import { NumericInput } from './NumericInput';
import { computeWorkoutStats, formatTime, resolveWatts } from '../utils/workoutMath';
import { parseWorkoutFileContent } from '../utils/workoutImporter';
import { useI18n } from '../i18n';

export interface WorkoutBuilderProps {
  initialWorkout?: Workout | null;
  ftp: number;
  onSave: (workout: Workout) => void;
  onCancel: () => void;
}

export const WorkoutBuilder: React.FC<WorkoutBuilderProps> = ({
  initialWorkout,
  ftp,
  onSave,
  onCancel,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState(initialWorkout?.name || t('builder.defaultName'));
  const [description, setDescription] = useState(initialWorkout?.description || '');
  const [blocks, setBlocks] = useState<WorkoutBlock[]>(
    initialWorkout?.blocks && initialWorkout.blocks.length > 0
      ? initialWorkout.blocks
      : [
          {
            id: 'b-warmup',
            label: t('builder.defaultWarmup'),
            type: 'ramp',
            durationSec: 600,
            unit: 'ftp_percent',
            powerStart: 45,
            powerEnd: 75,
            cadenceTarget: 90,
          },
          {
            id: 'b-work',
            label: t('builder.defaultMain'),
            type: 'steady',
            durationSec: 900,
            unit: 'ftp_percent',
            powerStart: 90,
            powerEnd: 90,
            cadenceTarget: 90,
          },
          {
            id: 'b-cooldown',
            label: t('builder.defaultCooldown'),
            type: 'ramp',
            durationSec: 300,
            unit: 'ftp_percent',
            powerStart: 70,
            powerEnd: 40,
            cadenceTarget: 85,
          },
        ]
  );

  // Interval mini-generator state
  const [showIntervalGen, setShowIntervalGen] = useState(false);
  const [genRepeats, setGenRepeats] = useState(5);
  const [genWorkMin, setGenWorkMin] = useState(3);
  const [genWorkSec, setGenWorkSec] = useState(0);
  const [genWorkPower, setGenWorkPower] = useState(105);
  const [genWorkUnit, setGenWorkUnit] = useState<PowerUnit>('ftp_percent');
  const [genWorkCadence, setGenWorkCadence] = useState<number | undefined>(95);

  const [genRestMin, setGenRestMin] = useState(2);
  const [genRestSec, setGenRestSec] = useState(0);
  const [genRestPower, setGenRestPower] = useState(50);
  const [genRestUnit, setGenRestUnit] = useState<PowerUnit>('ftp_percent');
  const [genRestCadence, setGenRestCadence] = useState<number | undefined>(85);

  const fileInputId = useId();

  // Create current workout object for chart preview and stats calculation
  const currentWorkout: Workout = {
    id: initialWorkout?.id || `workout-${Date.now()}`,
    name,
    description,
    createdAt: initialWorkout?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    blocks,
  };

  const stats = computeWorkoutStats(currentWorkout, ftp);

  // Block management functions
  const addSteadyBlock = () => {
    const newBlock: WorkoutBlock = {
      id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: t('builder.newSteadyLabel'),
      type: 'steady',
      durationSec: 300,
      unit: 'ftp_percent',
      powerStart: 80,
      powerEnd: 80,
      cadenceTarget: 90,
    };
    setBlocks([...blocks, newBlock]);
  };

  const addRampBlock = () => {
    const newBlock: WorkoutBlock = {
      id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: t('builder.newRampLabel'),
      type: 'ramp',
      durationSec: 300,
      unit: 'ftp_percent',
      powerStart: 50,
      powerEnd: 90,
      cadenceTarget: 90,
    };
    setBlocks([...blocks, newBlock]);
  };

  const generateIntervalSeries = () => {
    const workDurationSec = Math.max(genWorkMin * 60 + genWorkSec, 5);
    const restDurationSec = Math.max(genRestMin * 60 + genRestSec, 5);

    const newBlocks: WorkoutBlock[] = [];
    for (let i = 1; i <= genRepeats; i++) {
      newBlocks.push({
        id: `gen-work-${Date.now()}-${i}`,
        label: t('builder.genWorkLabel', { n: i }),
        type: 'steady',
        durationSec: workDurationSec,
        unit: genWorkUnit,
        powerStart: genWorkPower,
        powerEnd: genWorkPower,
        cadenceTarget: genWorkCadence,
      });

      newBlocks.push({
        id: `gen-rest-${Date.now()}-${i}`,
        label: t('builder.genRestLabel', { n: i }),
        type: 'steady',
        durationSec: restDurationSec,
        unit: genRestUnit,
        powerStart: genRestPower,
        powerEnd: genRestPower,
        cadenceTarget: genRestCadence,
      });
    }

    setBlocks([...blocks, ...newBlocks]);
    setShowIntervalGen(false);
  };

  const updateBlock = (index: number, updates: Partial<WorkoutBlock>) => {
    setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, ...updates } : b)));
  };

  const duplicateBlock = (index: number) => {
    const original = blocks[index];
    const clone: WorkoutBlock = {
      ...original,
      id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: t('builder.copySuffix', { label: original.label || t('builder.blockFallback') }),
    };
    const updated = [...blocks];
    updated.splice(index + 1, 0, clone);
    setBlocks(updated);
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === blocks.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...blocks];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    setBlocks(updated);
  };

  const deleteBlock = (index: number) => {
    if (blocks.length <= 1) {
      alert(t('builder.minOneBlockAlert'));
      return;
    }
    setBlocks(blocks.filter((_, i) => i !== index));
  };

  // Export JSON
  const handleExportJson = () => {
    const jsonStr = JSON.stringify(currentWorkout, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '_').toLowerCase() || 'workout'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import ZWO / MRC / ERG / JSON
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedList = parseWorkoutFileContent(file.name, String(event.target?.result || ''));
        const imported = importedList[0];
        if (imported) {
          setName(imported.name);
          setDescription(imported.description || '');
          setBlocks(imported.blocks);
        }
      } catch (err) {
        alert((err as Error).message || t('builder.importError'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert(t('builder.nameRequiredAlert'));
      return;
    }
    if (blocks.length === 0) {
      alert(t('builder.minOneBlockSaveAlert'));
      return;
    }
    onSave(currentWorkout);
  };

  return (
    <div style={{ maxWidth: '1360px', margin: '0 auto', padding: '24px', width: '100%' }}>
      {/* Top action row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary" onClick={onCancel}>
            <X size={18} /> {t('builder.cancel')}
          </button>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
            {initialWorkout ? t('builder.editTitle') : t('builder.createTitle')}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label
            htmlFor={fileInputId}
            className="btn btn-secondary"
            style={{ cursor: 'pointer', padding: '8px 14px' }}
            title={t('builder.importTitle')}
          >
            <Upload size={16} /> {t('builder.importBtn')}
          </label>
          <input
            id={fileInputId}
            type="file"
            accept=".zwo,.mrc,.erg,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />

          <button
            className="btn btn-secondary"
            onClick={handleExportJson}
            title={t('builder.exportTitle')}
          >
            <Download size={16} /> {t('builder.exportBtn')}
          </button>

          <button
            className="btn btn-emerald btn-lg"
            onClick={handleSave}
            style={{ padding: '10px 24px' }}
          >
            <Save size={18} /> {t('builder.saveBtn')}
          </button>
        </div>
      </div>

      {/* Basic metadata */}
      <div
        className="card"
        style={{
          marginBottom: '20px',
          display: 'grid',
          gridTemplateColumns: '2fr 3fr',
          gap: '16px',
        }}
      >
        <div>
          <label className="form-label">{t('builder.nameLabel')}</label>
          <input
            type="text"
            className="input-text"
            placeholder={t('builder.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ fontWeight: 700, fontSize: '1rem' }}
          />
        </div>
        <div>
          <label className="form-label">{t('builder.descLabel')}</label>
          <input
            type="text"
            className="input-text"
            placeholder={t('builder.descPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* Chart preview & computed stats */}
      <div className="card" style={{ marginBottom: '24px', padding: '20px 24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '14px',
          }}
        >
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-muted)' }}>
            {t('builder.chartTitle', { ftp })}
          </div>

          {/* Stats summary pills */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div className="stat-pill">
              <Clock size={13} style={{ color: 'var(--accent-cyan)' }} />
              <span>{t('builder.statDuration')}</span>
              <strong>{formatTime(stats.totalDurationSec)}</strong>
            </div>
            <div className="stat-pill">
              <Zap size={13} style={{ color: 'var(--accent-amber)' }} />
              <span>{t('builder.statAvg')}</span>
              <strong>{stats.avgWatts} W</strong>
            </div>
            <div className="stat-pill">
              <Activity size={13} style={{ color: 'var(--accent-emerald)' }} />
              <span>NP:</span>
              <strong>{stats.normalizedPower} W</strong>
            </div>
            <div className="stat-pill">
              <span>IF:</span>
              <strong>{stats.intensityFactor.toFixed(2)}</strong>
            </div>
            <div className="stat-pill">
              <span>TSS:</span>
              <strong>{stats.tss}</strong>
            </div>
            <div className="stat-pill">
              <Flame size={13} style={{ color: 'var(--accent-rose)' }} />
              <span>{t('builder.statEnergy')}</span>
              <strong>~{stats.estimatedKcal} kcal ({stats.workKj} kJ)</strong>
            </div>
          </div>
        </div>

        {/* Live Responsive Chart */}
        <div style={{ background: '#090d16', borderRadius: '10px', padding: '12px 16px' }}>
          <WorkoutChart workout={currentWorkout} ftp={ftp} height={170} interactive={true} />
        </div>
      </div>

      {/* Add Blocks Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
          {t('builder.blocksHeader', { count: blocks.length })}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={addSteadyBlock}>
            <Plus size={16} /> {t('builder.addSteadyBtn')}
          </button>
          <button className="btn btn-secondary" onClick={addRampBlock}>
            <TrendingUp size={16} /> {t('builder.addRampBtn')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowIntervalGen(!showIntervalGen)}
            style={{ background: showIntervalGen ? '#0369a1' : undefined }}
          >
            <Layers size={16} /> {t('builder.addSeriesBtn')}
          </button>
        </div>
      </div>

      {/* Inline Interval Generator Panel */}
      {showIntervalGen && (
        <div
          className="card"
          style={{
            marginBottom: '20px',
            background: 'linear-gradient(180deg, #162033 0%, #111827 100%)',
            borderColor: '#0284c7',
            padding: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={20} style={{ color: 'var(--accent-cyan)' }} />
              <strong style={{ fontSize: '1rem', color: '#f8fafc' }}>
                {t('builder.genTitle')}
              </strong>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setShowIntervalGen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr 1fr auto',
              gap: '16px',
              alignItems: 'end',
            }}
          >
            <div>
              <label className="form-label">{t('builder.genRepeats')}</label>
              <NumericInput
                min={1}
                fallback={1}
                className="input-number"
                value={genRepeats}
                onChange={setGenRepeats}
              />
            </div>

            {/* Work interval settings */}
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.08)',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(56, 189, 248, 0.2)',
              }}
            >
              <div
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: 'var(--accent-cyan)',
                  marginBottom: 8,
                }}
              >
                {t('builder.genWorkTitle')}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <NumericInput
                  min={0}
                  allowZero
                  fallback={0}
                  placeholder={t('builder.minPlaceholder')}
                  className="input-number"
                  style={{ width: '65px' }}
                  value={genWorkMin}
                  onChange={setGenWorkMin}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>m</span>
                <NumericInput
                  min={0}
                  max={59}
                  allowZero
                  fallback={0}
                  placeholder={t('builder.secPlaceholder')}
                  className="input-number"
                  style={{ width: '65px' }}
                  value={genWorkSec}
                  onChange={setGenWorkSec}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>s</span>
                <span style={{ color: 'var(--text-muted)' }}>@</span>
                <NumericInput
                  min={1}
                  fallback={100}
                  className="input-number"
                  style={{ width: '80px' }}
                  value={genWorkPower}
                  onChange={setGenWorkPower}
                />
                <select
                  className="select-input"
                  style={{ width: '90px' }}
                  value={genWorkUnit}
                  onChange={(e) => setGenWorkUnit(e.target.value as PowerUnit)}
                >
                  <option value="ftp_percent">% FTP</option>
                  <option value="watts">{t('builder.wattsOption')}</option>
                </select>
              </div>
            </div>

            {/* Rest interval settings */}
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(16, 185, 129, 0.2)',
              }}
            >
              <div
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: 'var(--accent-emerald)',
                  marginBottom: 8,
                }}
              >
                {t('builder.genRestTitle')}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <NumericInput
                  min={0}
                  allowZero
                  fallback={0}
                  placeholder={t('builder.minPlaceholder')}
                  className="input-number"
                  style={{ width: '65px' }}
                  value={genRestMin}
                  onChange={setGenRestMin}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>m</span>
                <NumericInput
                  min={0}
                  max={59}
                  allowZero
                  fallback={0}
                  placeholder={t('builder.secPlaceholder')}
                  className="input-number"
                  style={{ width: '65px' }}
                  value={genRestSec}
                  onChange={setGenRestSec}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>s</span>
                <span style={{ color: 'var(--text-muted)' }}>@</span>
                <NumericInput
                  min={1}
                  fallback={50}
                  className="input-number"
                  style={{ width: '80px' }}
                  value={genRestPower}
                  onChange={setGenRestPower}
                />
                <select
                  className="select-input"
                  style={{ width: '90px' }}
                  value={genRestUnit}
                  onChange={(e) => setGenRestUnit(e.target.value as PowerUnit)}
                >
                  <option value="ftp_percent">% FTP</option>
                  <option value="watts">{t('builder.wattsOption')}</option>
                </select>
              </div>
            </div>

            <div>
              <button
                className="btn btn-emerald"
                style={{ padding: '10px 18px' }}
                onClick={generateIntervalSeries}
              >
                {t('builder.genSubmitBtn', { count: genRepeats * 2 })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocks List */}
      <div>
        {blocks.map((block, idx) => {
          const durationMin = Math.floor(block.durationSec / 60);
          const durationSecRem = block.durationSec % 60;

          // Compute live converted equivalent watts or %
          const resolvedStartW = resolveWatts(block.powerStart, block.unit, ftp);
          const resolvedEndW =
            block.type === 'ramp' ? resolveWatts(block.powerEnd, block.unit, ftp) : resolvedStartW;

          return (
            <div key={block.id || idx} className="builder-block-row">
              {/* Order number */}
              <div
                style={{
                  fontWeight: 700,
                  color: 'var(--text-dim)',
                  fontSize: '0.85rem',
                  textAlign: 'center',
                }}
              >
                #{idx + 1}
              </div>

              {/* Label */}
              <div>
                <input
                  type="text"
                  className="input-text"
                  placeholder={t('builder.blockLabelPlaceholder')}
                  value={block.label || ''}
                  onChange={(e) => updateBlock(idx, { label: e.target.value })}
                />
              </div>

              {/* Type */}
              <div>
                <select
                  className="select-input"
                  value={block.type}
                  onChange={(e) => {
                    const newType = e.target.value as BlockType;
                    updateBlock(idx, {
                      type: newType,
                      powerEnd: newType === 'steady' ? block.powerStart : block.powerEnd || block.powerStart,
                    });
                  }}
                >
                  <option value="steady">{t('builder.typeSteady')}</option>
                  <option value="ramp">{t('builder.typeRamp')}</option>
                </select>
              </div>

              {/* Duration (Min + Sec) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <NumericInput
                  min={0}
                  allowZero
                  fallback={0}
                  className="input-number"
                  style={{ width: '60px' }}
                  value={durationMin}
                  onChange={(m) => updateBlock(idx, { durationSec: m * 60 + durationSecRem })}
                />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>m</span>
                <NumericInput
                  min={0}
                  max={59}
                  allowZero
                  fallback={0}
                  className="input-number"
                  style={{ width: '56px' }}
                  value={durationSecRem}
                  onChange={(s) => updateBlock(idx, { durationSec: durationMin * 60 + s })}
                />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>s</span>
              </div>

              {/* Power & Unit + Live Converted Equivalent */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {block.type === 'steady' ? (
                  <NumericInput
                    min={1}
                    fallback={block.powerStart}
                    className="input-number"
                    style={{ width: '75px' }}
                    value={block.powerStart}
                    onChange={(val) => updateBlock(idx, { powerStart: val, powerEnd: val })}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <NumericInput
                      min={1}
                      fallback={block.powerStart}
                      className="input-number"
                      style={{ width: '62px' }}
                      value={block.powerStart}
                      onChange={(val) => updateBlock(idx, { powerStart: val })}
                    />
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>→</span>
                    <NumericInput
                      min={1}
                      fallback={block.powerEnd}
                      className="input-number"
                      style={{ width: '62px' }}
                      value={block.powerEnd}
                      onChange={(val) => updateBlock(idx, { powerEnd: val })}
                    />
                  </div>
                )}

                <select
                  className="select-input"
                  style={{ width: '84px' }}
                  value={block.unit}
                  onChange={(e) => updateBlock(idx, { unit: e.target.value as PowerUnit })}
                >
                  <option value="ftp_percent">% FTP</option>
                  <option value="watts">W</option>
                </select>

                {/* Live converted equivalent pill */}
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: '#38bdf8',
                    background: 'rgba(56, 189, 248, 0.1)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {block.unit === 'ftp_percent'
                    ? block.type === 'steady'
                      ? `≈ ${Math.round(resolvedStartW)} W`
                      : `≈ ${Math.round(resolvedStartW)}-${Math.round(resolvedEndW)} W`
                    : block.type === 'steady'
                    ? `≈ ${Math.round((block.powerStart / ftp) * 100)}%`
                    : `≈ ${Math.round((block.powerStart / ftp) * 100)}-${Math.round(
                        (block.powerEnd / ftp) * 100
                      )}%`}
                </span>
              </div>

              {/* Target Cadence */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <NumericInput
                  min={1}
                  allowEmpty
                  placeholder="RPM"
                  className="input-number"
                  style={{ width: '64px' }}
                  value={block.cadenceTarget}
                  onChangeOptional={(v) => updateBlock(idx, { cadenceTarget: v })}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>RPM</span>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: '30px', height: '30px' }}
                  onClick={() => moveBlock(idx, 'up')}
                  disabled={idx === 0}
                  title={t('builder.moveUpTitle')}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: '30px', height: '30px' }}
                  onClick={() => moveBlock(idx, 'down')}
                  disabled={idx === blocks.length - 1}
                  title={t('builder.moveDownTitle')}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: '30px', height: '30px' }}
                  onClick={() => duplicateBlock(idx)}
                  title={t('builder.duplicateTitle')}
                >
                  <Copy size={14} />
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ width: '30px', height: '30px', color: '#f87171' }}
                  onClick={() => deleteBlock(idx)}
                  title={t('builder.deleteTitle')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

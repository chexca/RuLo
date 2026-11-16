import { Workout, WorkoutBlock, PowerUnit } from '../types/workout';

function makeId(prefix = 'blk'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Parses .zwo (Zwift XML), .mrc (% FTP), .erg (Watts), or .json workouts
 * and returns one or more Rulo ERG Workout objects.
 */
export function parseWorkoutFileContent(fileName: string, rawContent: string): Workout[] {
  const trimmed = rawContent.trim();
  const ext = fileName.toLowerCase().split('.').pop() || '';
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'Sesión Importada';
  const nowIso = new Date().toISOString();

  // 1. JSON format (single Workout or Workout[])
  if (ext === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const valid: Workout[] = items
      .filter((w) => w && Array.isArray(w.blocks) && w.blocks.length > 0)
      .map((w) => ({
        id: makeId('wkt'),
        name: typeof w.name === 'string' && w.name.trim() ? w.name.trim() : baseName,
        description: typeof w.description === 'string' ? w.description : undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
        blocks: w.blocks.map((b: Partial<WorkoutBlock>) => ({
          id: makeId('blk'),
          label: b.label,
          type: b.type === 'ramp' ? 'ramp' : 'steady',
          durationSec: Math.max(5, Math.round(Number(b.durationSec) || 60)),
          unit: b.unit === 'watts' ? 'watts' : 'ftp_percent',
          powerStart: Math.max(10, Math.round(Number(b.powerStart) || 100)),
          powerEnd: Math.max(10, Math.round(Number(b.powerEnd ?? b.powerStart) || 100)),
          cadenceTarget: b.cadenceTarget ? Number(b.cadenceTarget) : undefined,
        })),
      }));

    if (valid.length === 0) {
      throw new Error('El archivo JSON no contiene bloques de entrenamiento válidos.');
    }
    return valid;
  }

  // 2. ZWO (Zwift XML) format
  if (ext === 'zwo' || trimmed.startsWith('<')) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, 'text/xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) {
      throw new Error('El archivo XML/.ZWO tiene un formato inválido.');
    }

    const nameEl = doc.querySelector('workout_file > name, name');
    const descEl = doc.querySelector('workout_file > description, description');
    const workoutEl = doc.querySelector('workout');
    if (!workoutEl) {
      throw new Error('No se encontró la etiqueta <workout> en el archivo .ZWO.');
    }

    const toPct = (attrVal: string | null, fallback = 0.6): number => {
      const n = parseFloat(attrVal ?? '');
      if (Number.isNaN(n)) return Math.round(fallback * 100);
      // Zwift stores fractions (e.g. 0.75 = 75%), handle if already > 3 as percentage
      return Math.max(20, Math.round(n <= 3.5 ? n * 100 : n));
    };

    const blocks: WorkoutBlock[] = [];
    for (const el of Array.from(workoutEl.children)) {
      const tag = el.tagName.toLowerCase();
      const dur = Math.max(5, Math.round(parseFloat(el.getAttribute('Duration') || '60')));
      const cadenceAttr = el.getAttribute('Cadence');
      const cadenceTarget = cadenceAttr ? Math.round(parseFloat(cadenceAttr)) : undefined;

      if (tag === 'steadystate') {
        const pct = toPct(el.getAttribute('Power') ?? el.getAttribute('PowerLow'), 0.65);
        blocks.push({
          id: makeId(),
          label: 'Bloque Fijo',
          type: 'steady',
          durationSec: dur,
          unit: 'ftp_percent',
          powerStart: pct,
          powerEnd: pct,
          cadenceTarget,
        });
      } else if (tag === 'warmup' || tag === 'ramp') {
        const pStart = toPct(el.getAttribute('PowerLow'), 0.5);
        const pEnd = toPct(el.getAttribute('PowerHigh'), 0.75);
        blocks.push({
          id: makeId(),
          label: tag === 'warmup' ? 'Calentamiento' : 'Rampa',
          type: pStart === pEnd ? 'steady' : 'ramp',
          durationSec: dur,
          unit: 'ftp_percent',
          powerStart: pStart,
          powerEnd: pEnd,
          cadenceTarget,
        });
      } else if (tag === 'cooldown') {
        const pLow = toPct(el.getAttribute('PowerLow'), 0.45);
        const pHigh = toPct(el.getAttribute('PowerHigh'), 0.7);
        // In ZWO <Cooldown>, some editors put start in PowerLow (> PowerHigh), others put higher in PowerHigh
        const pStart = pLow >= pHigh ? pLow : pHigh;
        const pEnd = pLow >= pHigh ? pHigh : pLow;
        blocks.push({
          id: makeId(),
          label: 'Enfriamiento',
          type: pStart === pEnd ? 'steady' : 'ramp',
          durationSec: dur,
          unit: 'ftp_percent',
          powerStart: pStart,
          powerEnd: pEnd,
          cadenceTarget,
        });
      } else if (tag === 'intervalst') {
        const repeat = Math.max(1, Math.round(parseFloat(el.getAttribute('Repeat') || '1')));
        const onDur = Math.max(5, Math.round(parseFloat(el.getAttribute('OnDuration') || '60')));
        const offDur = Math.max(5, Math.round(parseFloat(el.getAttribute('OffDuration') || '60')));
        const onPct = toPct(el.getAttribute('OnPower'), 1.0);
        const offPct = toPct(el.getAttribute('OffPower'), 0.5);
        const restCad = el.getAttribute('CadenceResting')
          ? Math.round(parseFloat(el.getAttribute('CadenceResting')!))
          : undefined;

        for (let i = 1; i <= repeat; i++) {
          blocks.push({
            id: makeId(),
            label: `Serie ${i}/${repeat}`,
            type: 'steady',
            durationSec: onDur,
            unit: 'ftp_percent',
            powerStart: onPct,
            powerEnd: onPct,
            cadenceTarget,
          });
          blocks.push({
            id: makeId(),
            label: `Recuperación ${i}/${repeat}`,
            type: 'steady',
            durationSec: offDur,
            unit: 'ftp_percent',
            powerStart: offPct,
            powerEnd: offPct,
            cadenceTarget: restCad,
          });
        }
      } else if (tag === 'freeride' || tag === 'maxeffort') {
        const pct = tag === 'maxeffort' ? 130 : 60;
        blocks.push({
          id: makeId(),
          label: tag === 'maxeffort' ? 'Esfuerzo Máximo' : 'Rodaje Libre',
          type: 'steady',
          durationSec: dur,
          unit: 'ftp_percent',
          powerStart: pct,
          powerEnd: pct,
        });
      }
    }

    if (blocks.length === 0) {
      throw new Error('No se encontraron bloques compatibles en el archivo .ZWO.');
    }

    return [
      {
        id: makeId('wkt'),
        name: nameEl?.textContent?.trim() || baseName,
        description: descEl?.textContent?.trim() || 'Importado desde archivo .ZWO',
        createdAt: nowIso,
        updatedAt: nowIso,
        blocks,
      },
    ];
  }

  // 3. MRC / ERG text format ([COURSE HEADER] ... [COURSE DATA])
  if (ext === 'mrc' || ext === 'erg' || /\[COURSE DATA\]/i.test(trimmed)) {
    const lines = trimmed.split(/\r?\n/);
    let inHeader = false;
    let inData = false;
    let name = baseName;
    let description = '';
    let unit: PowerUnit = ext === 'erg' ? 'watts' : 'ftp_percent';

    const points: { min: number; val: number }[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';')) continue;
      if (/^\[COURSE HEADER\]$/i.test(line)) {
        inHeader = true;
        inData = false;
        continue;
      }
      if (/^\[END COURSE HEADER\]$/i.test(line)) {
        inHeader = false;
        continue;
      }
      if (/^\[COURSE DATA\]$/i.test(line)) {
        inHeader = false;
        inData = true;
        continue;
      }
      if (/^\[END COURSE DATA\]$/i.test(line)) {
        inData = false;
        continue;
      }

      if (inHeader) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          const k = line.slice(0, eqIdx).trim().toUpperCase();
          const v = line.slice(eqIdx + 1).trim();
          if (k === 'FILE NAME' && v) name = v.replace(/\.[^.]+$/, '');
          if (k === 'DESCRIPTION' && v) description = v;
        } else if (/WATTS/i.test(line)) {
          unit = 'watts';
        } else if (/PERCENT/i.test(line)) {
          unit = 'ftp_percent';
        }
      } else if (inData) {
        const parts = line.split(/[\s,;]+/);
        if (parts.length >= 2) {
          const min = parseFloat(parts[0]);
          const val = parseFloat(parts[1]);
          if (!Number.isNaN(min) && !Number.isNaN(val)) {
            points.push({ min, val });
          }
        }
      }
    }

    const blocks: WorkoutBlock[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const dtSec = Math.round((p1.min - p0.min) * 60);
      if (dtSec <= 0) continue;

      const v0 = Math.round(p0.val);
      const v1 = Math.round(p1.val);
      const isSteady = Math.abs(v1 - v0) <= 1;
      blocks.push({
        id: makeId(),
        type: isSteady ? 'steady' : 'ramp',
        durationSec: dtSec,
        unit,
        powerStart: v0,
        powerEnd: isSteady ? v0 : v1,
      });
    }

    // Merge consecutive identical steady blocks if fragmented
    const merged: WorkoutBlock[] = [];
    for (const b of blocks) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        prev.type === 'steady' &&
        b.type === 'steady' &&
        prev.unit === b.unit &&
        prev.powerStart === b.powerStart
      ) {
        prev.durationSec += b.durationSec;
      } else {
        merged.push(b);
      }
    }

    if (merged.length === 0) {
      throw new Error('No se encontraron intervalos válidos en el archivo .MRC / .ERG.');
    }

    return [
      {
        id: makeId('wkt'),
        name,
        description: description || `Importado desde archivo .${ext.toUpperCase() || 'MRC/ERG'}`,
        createdAt: nowIso,
        updatedAt: nowIso,
        blocks: merged,
      },
    ];
  }

  throw new Error('Formato no reconocido. Usa archivos .ZWO, .MRC, .ERG o .JSON.');
}

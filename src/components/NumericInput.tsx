import React, { useState, useEffect, useRef } from 'react';

export interface NumericInputProps {
  value: number | undefined;
  onChange?: (val: number) => void;
  onChangeOptional?: (val: number | undefined) => void;
  allowEmpty?: boolean;
  allowZero?: boolean;
  allowDecimal?: boolean;
  min?: number;
  max?: number;
  fallback?: number;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  id?: string;
}

function sanitizeInput(raw: string, allowDecimal: boolean): string {
  if (!allowDecimal) {
    return raw.replace(/\D/g, '');
  }
  let hasSep = false;
  let out = '';
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if ((ch === '.' || ch === ',') && !hasSep) {
      hasSep = true;
      out += ch;
    }
  }
  return out;
}

function parseDraft(raw: string, allowDecimal: boolean): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!allowDecimal) {
    if (!/^\d+$/.test(trimmed)) return null;
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : null;
  }
  const normalized = trimmed.replace(',', '.');
  if (normalized === '.') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatValue(val: number | undefined): string {
  return val !== undefined && Number.isFinite(val) ? String(val) : '';
}

export const NumericInput: React.FC<NumericInputProps> = ({
  value,
  onChange,
  onChangeOptional,
  allowEmpty = false,
  allowZero = false,
  allowDecimal = false,
  min,
  max,
  fallback,
  className,
  style,
  placeholder,
  title,
  disabled,
  id,
}) => {
  const effectiveMin = min ?? (allowZero ? 0 : 1);
  const isFocusedRef = useRef(false);
  const [draft, setDraft] = useState<string>(() => formatValue(value));

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(formatValue(value));
    }
  }, [value]);

  const handleFocus = () => {
    isFocusedRef.current = true;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextDraft = sanitizeInput(e.target.value, allowDecimal);
    setDraft(nextDraft);

    if (nextDraft.trim() === '') {
      if (allowEmpty) {
        onChangeOptional?.(undefined);
      }
      return;
    }

    const parsed = parseDraft(nextDraft, allowDecimal);
    if (parsed === null || !Number.isFinite(parsed)) {
      return;
    }

    if (parsed < effectiveMin) {
      return;
    }
    if (max !== undefined && parsed > max) {
      return;
    }

    onChange?.(parsed);
    onChangeOptional?.(parsed);
  };

  const handleBlur = () => {
    isFocusedRef.current = false;

    if (draft.trim() === '') {
      if (allowEmpty) {
        onChangeOptional?.(undefined);
        setDraft('');
      } else {
        setDraft(formatValue(value ?? fallback ?? effectiveMin));
      }
      return;
    }

    const parsed = parseDraft(draft, allowDecimal);
    if (parsed === null || !Number.isFinite(parsed)) {
      if (allowEmpty) {
        onChangeOptional?.(undefined);
        setDraft('');
      } else {
        setDraft(formatValue(value ?? fallback ?? effectiveMin));
      }
      return;
    }

    let finalVal = parsed;
    if (finalVal < effectiveMin) {
      finalVal = effectiveMin;
    }
    if (max !== undefined && finalVal > max) {
      finalVal = max;
    }

    onChange?.(finalVal);
    onChangeOptional?.(finalVal);
    setDraft(String(finalVal));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      className={className}
      style={style}
      placeholder={placeholder}
      title={title}
      disabled={disabled}
      value={draft}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
};

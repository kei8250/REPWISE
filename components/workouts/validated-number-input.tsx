'use client';

import { useId, useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';

type Props = Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'
> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min: number;
  max: number;
  scale?: number;
};

export function ValidatedNumberInput({
  value,
  onValueChange,
  min,
  max,
  scale = 1,
  id,
  required = false,
  ...props
}: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState<{
    raw: string;
    committed: number | null;
  } | null>(null);
  const raw =
    draft && draft.committed === value
      ? draft.raw
      : value === null
        ? ''
        : String(value / scale);
  const valid =
    (raw === '' && !required) ||
    (raw !== '' &&
      /^(\d+(\.\d*)?|\.\d+)$/.test(raw) &&
      Number(raw) >= min &&
      Number(raw) <= max &&
      Math.abs(Number(raw) * scale - Math.round(Number(raw) * scale)) < 1e-7);
  const error = valid
    ? ''
    : raw === ''
      ? '入力してください'
      : scale === 1
        ? `${min}〜${max}の整数で入力してください`
        : `${min}〜${max}kgを小数3桁以内で入力してください`;
  return (
    <div className="min-w-0">
      <Input
        {...props}
        id={inputId}
        type="text"
        required={required}
        inputMode={scale === 1 ? 'numeric' : 'decimal'}
        value={raw}
        aria-invalid={!valid}
        aria-describedby={error ? `${inputId}-error` : undefined}
        ref={(element) => {
          element?.setCustomValidity(error);
        }}
        onChange={(event) => {
          const nextRaw = event.target.value;
          const parsed = nextRaw === '' ? null : Number(nextRaw) * scale;
          const isValid =
            nextRaw === '' ||
            (/^(\d+(\.\d*)?|\.\d+)$/.test(nextRaw) &&
              Number(nextRaw) >= min &&
              Number(nextRaw) <= max &&
              Math.abs(parsed! - Math.round(parsed!)) < 1e-7);
          const next = isValid
            ? parsed === null
              ? null
              : Math.round(parsed)
            : value;
          setDraft({ raw: nextRaw, committed: next });
          if (nextRaw === '') {
            setDraft({ raw: '', committed: null });
            onValueChange(null);
          } else if (isValid) onValueChange(next);
        }}
      />
      {error && (
        <p
          id={`${inputId}-error`}
          className="mt-1 break-words text-xs text-destructive"
          aria-live="polite"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function reportInvalidWorkoutInput(
  root: HTMLElement | Document | null = document,
) {
  const invalid = root?.querySelector<HTMLInputElement>('input:invalid');
  if (!invalid) return false;
  invalid.focus();
  invalid.scrollIntoView({ block: 'center' });
  invalid.reportValidity();
  return true;
}

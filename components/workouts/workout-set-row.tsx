'use client';

import { ArrowDown, ArrowUp, Check, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { WorkoutSet } from '@/lib/workouts/types';
import { cn } from '@/lib/utils';

function gramsToKg(value: number | null) {
  return value === null ? '' : String(value / 1000);
}
function kgToGrams(value: string) {
  return value === '' ? null : Math.round(Number(value) * 1000);
}
function optionalInteger(value: string) {
  return value === '' ? null : Number(value);
}

export function WorkoutSetRow({
  set,
  number,
  onChange,
  onDelete,
  canDelete,
  isFirst,
  isLast,
  onMove,
}: {
  set: WorkoutSet;
  number: number;
  onChange: (set: WorkoutSet) => void;
  onDelete: () => void;
  canDelete: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const completed = set.status === 'completed';
  const patch = (values: Partial<WorkoutSet>) =>
    onChange({ ...set, ...values, updatedAt: new Date().toISOString() });
  const canComplete = set.actualLoadGrams !== null && set.actualReps !== null;
  const fieldId = (field: string) => `${set.id}-${field}`;
  return (
    <div
      className={cn(
        'rounded-2xl border bg-card p-3 transition',
        completed && 'border-primary/40 bg-primary/[.035]',
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'grid size-7 place-items-center rounded-full text-xs font-black',
              completed ? 'bg-primary text-primary-foreground' : 'bg-muted',
            )}
          >
            {completed ? <Check className="size-4" /> : number}
          </span>
          <span className="text-xs font-bold text-muted-foreground">
            SET {number}
          </span>
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isFirst}
            aria-label={`セット${number}を前へ移動`}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isLast}
            aria-label={`セット${number}を後ろへ移動`}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!canDelete}
            aria-label={`セット${number}を削除`}
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <div>
          <label
            htmlFor={fieldId('actual-load')}
            className="text-xs font-semibold text-muted-foreground"
          >
            重量（kg）
          </label>
          <Input
            id={fieldId('actual-load')}
            aria-label={`セット${number}の実績重量`}
            inputMode="decimal"
            type="number"
            min="0"
            step="0.25"
            value={gramsToKg(set.actualLoadGrams)}
            onChange={(event) =>
              patch({ actualLoadGrams: kgToGrams(event.target.value) })
            }
            className="mt-1 h-11 text-lg font-black"
          />
        </div>
        <div>
          <label
            htmlFor={fieldId('actual-reps')}
            className="text-xs font-semibold text-muted-foreground"
          >
            rep
          </label>
          <Input
            id={fieldId('actual-reps')}
            aria-label={`セット${number}の実績rep`}
            inputMode="numeric"
            type="number"
            min="0"
            max="999"
            value={set.actualReps ?? ''}
            onChange={(event) =>
              patch({ actualReps: optionalInteger(event.target.value) })
            }
            className="mt-1 h-11 text-lg font-black"
          />
        </div>
        <Button
          type="button"
          size="icon"
          disabled={!completed && !canComplete}
          className={cn(
            'size-11',
            completed && 'bg-muted text-foreground hover:bg-muted',
          )}
          aria-label={
            completed
              ? `セット${number}を未完了に戻す`
              : `セット${number}を完了`
          }
          onClick={() =>
            patch(
              completed
                ? { status: 'planned', completedAt: null }
                : {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                  },
            )
          }
        >
          {completed ? <RotateCcw /> : <Check />}
        </Button>
      </div>
      <details className="mt-3 rounded-xl bg-muted/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-bold text-muted-foreground">
          目標とセットメモ
        </summary>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <label
              htmlFor={fieldId('target-load')}
              className="text-[11px] text-muted-foreground"
            >
              目標kg
            </label>
            <Input
              id={fieldId('target-load')}
              aria-label={`セット${number}の目標重量`}
              inputMode="decimal"
              type="number"
              min="0"
              step="0.25"
              value={gramsToKg(set.targetLoadGrams)}
              onChange={(event) =>
                patch({ targetLoadGrams: kgToGrams(event.target.value) })
              }
              className="mt-1"
            />
          </div>
          <div>
            <label
              htmlFor={fieldId('target-min')}
              className="text-[11px] text-muted-foreground"
            >
              rep下限
            </label>
            <Input
              id={fieldId('target-min')}
              aria-label={`セット${number}の目標rep下限`}
              inputMode="numeric"
              type="number"
              min="0"
              value={set.targetRepMin ?? ''}
              onChange={(event) =>
                patch({ targetRepMin: optionalInteger(event.target.value) })
              }
              className="mt-1"
            />
          </div>
          <div>
            <label
              htmlFor={fieldId('target-max')}
              className="text-[11px] text-muted-foreground"
            >
              rep上限
            </label>
            <Input
              id={fieldId('target-max')}
              aria-label={`セット${number}の目標rep上限`}
              inputMode="numeric"
              type="number"
              min="0"
              value={set.targetRepMax ?? ''}
              onChange={(event) =>
                patch({ targetRepMax: optionalInteger(event.target.value) })
              }
              className="mt-1"
            />
          </div>
        </div>
        <Textarea
          aria-label={`セット${number}のメモ`}
          value={set.memo}
          maxLength={2000}
          onChange={(event) => patch({ memo: event.target.value })}
          placeholder="フォームや違和感など、このセットのメモ"
          className="mt-2 min-h-16 resize-none bg-background"
        />
      </details>
    </div>
  );
}

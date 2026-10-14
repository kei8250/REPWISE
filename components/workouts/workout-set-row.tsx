'use client';

import { useState } from 'react';
import type { ExerciseHistoryEntry } from '@/lib/workouts/history';
import { validReferenceSet, targetFromReference } from '@/lib/workouts/history';
import { ArrowDown, ArrowUp, Check, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { WorkoutSet } from '@/lib/workouts/types';
import type { SetComparison } from '@/lib/progression/active-workout';
import { cn } from '@/lib/utils';
import { setPerformanceLabel } from '@/lib/workouts/history';

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
  comparison,
  previousRecords = [],
  historyStatus = 'success',
  recentRecord,
  isNext = false,
}: {
  set: WorkoutSet;
  number: number;
  onChange: (set: WorkoutSet) => void;
  onDelete: () => void;
  canDelete: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  comparison: SetComparison;
  previousRecords?: Array<{
    localDate: string;
    label: string;
    set: WorkoutSet;
    exerciseNote?: string;
  }>;
  recentRecord?: ExerciseHistoryEntry;
  isNext?: boolean;
  historyStatus?: 'loading' | 'success' | 'error';
}) {
  const [editing, setEditing] = useState(false);
  const completed = set.status === 'completed';
  const patch = (values: Partial<WorkoutSet>) =>
    onChange({ ...set, ...values, updatedAt: new Date().toISOString() });
  const canComplete =
    set.actualLoadGrams !== null &&
    Number.isInteger(set.actualLoadGrams) &&
    set.actualLoadGrams >= 0 &&
    set.actualLoadGrams <= 2_000_000 &&
    set.actualReps !== null &&
    Number.isInteger(set.actualReps) &&
    set.actualReps > 0 &&
    set.actualReps <= 999;
  const fieldId = (field: string) => `${set.id}-${field}`;
  if (completed && !editing)
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold">
            ✓ SET {number} · {setPerformanceLabel(set)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setEditing(true)}
          >
            確認・編集
          </Button>
        </div>
        {set.targetLoadGrams !== null && set.targetRepMin !== null && (
          <p className="mt-1 text-xs">
            今回の結果：
            {set.actualLoadGrams! >= set.targetLoadGrams &&
            set.actualReps! >= set.targetRepMin
              ? '目標下限を達成'
              : '目標下限まであと一歩'}
          </p>
        )}
        {set.memo && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs">
            {set.memo}
          </p>
        )}
        {comparison.label && <p className="mt-1 text-xs">{comparison.label}</p>}
      </div>
    );
  return (
    <div
      id={`workout-set-${set.id}`}
      className={cn(
        'min-w-0 scroll-mt-[calc(var(--recording-header-height,144px)+16px)] rounded-2xl border bg-card p-3 transition [&_input]:scroll-mt-[calc(var(--recording-header-height,144px)+24px)] [&_textarea]:scroll-mt-[calc(var(--recording-header-height,144px)+24px)]',
        completed && 'border-primary/40 bg-primary/[.035]',
        isNext && 'border-primary ring-1 ring-primary/30',
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
            {isNext ? '次に取り組む · ' : ''}SET {number}
          </span>
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={isFirst}
            aria-label={`セット${number}を前へ移動`}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={isLast}
            aria-label={`セット${number}を後ろへ移動`}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            disabled={!canDelete}
            aria-label={`セット${number}を削除`}
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {completed && (
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          編集を閉じる
        </Button>
      )}
      <div className="mb-3 rounded-xl bg-primary/5 px-3 py-2 text-xs">
        {historyStatus === 'loading' ? (
          <p className="text-muted-foreground">このセットの過去記録を確認中…</p>
        ) : historyStatus === 'error' ? (
          <p className="text-muted-foreground">
            過去記録を取得できませんでした
          </p>
        ) : previousRecords.length === 0 ? (
          <p className="text-muted-foreground">SET {number}の過去記録なし</p>
        ) : (
          previousRecords.map((record) => (
            <div key={record.localDate + record.set.id} className="py-1">
              <p className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <span className="text-muted-foreground">
                  {record.label} {record.localDate} · SET{' '}
                  {record.set.position + 1}
                </span>
                <span className="font-bold tabular-nums">
                  {setPerformanceLabel(record.set)}
                  {record.set.status === 'skipped'
                    ? '（スキップ）'
                    : record.set.status !== 'completed'
                      ? '（未完了）'
                      : ''}
                </span>
              </p>
              {record.exerciseNote && (
                <p className="mt-1 whitespace-pre-wrap break-words">
                  種目メモ：{record.exerciseNote}
                </p>
              )}
              {record.set.memo && (
                <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                  セットメモ：{record.set.memo}
                </p>
              )}
            </div>
          ))
        )}
      </div>
      {recentRecord &&
        recentRecord.workoutId !== undefined &&
        !recentRecord.sets.some(
          (item) => item.position === set.position && validReferenceSet(item),
        ) && (
          <p className="mb-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            直近の記録 {recentRecord.localDate}（このセットは参考実績なし）
            {recentRecord.note && ` · 種目メモ：${recentRecord.note}`}
            {recentRecord.sets.find((item) => item.position === set.position)
              ?.memo &&
              ` · セットメモ：${recentRecord.sets.find((item) => item.position === set.position)?.memo}`}
          </p>
        )}
      <div className="mb-3 rounded-xl border border-dashed p-3">
        <p className="text-xs font-bold">今回の目標（実績とは別に保存）</p>
        {previousRecords[0] && (
          <Button
            type="button"
            variant="ghost"
            className="mt-1 min-h-11 whitespace-normal text-xs"
            onClick={() =>
              onChange({
                ...targetFromReference(set, previousRecords[0].set),
                updatedAt: new Date().toISOString(),
              })
            }
          >
            前回の実績を目標にコピー
          </Button>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(['targetLoadGrams', 'targetRepMin', 'targetRepMax'] as const).map(
            (field, index) => (
              <label key={field} className="min-w-0 text-xs">
                {['目標kg', 'rep下限', 'rep上限'][index]}
                <Input
                  aria-label={`セット${number}の${['目標重量', '目標rep下限', '目標rep上限'][index]}`}
                  type="number"
                  inputMode={index === 0 ? 'decimal' : 'numeric'}
                  min="0"
                  step={index === 0 ? '0.001' : '1'}
                  className="mt-1 h-11 min-w-0 text-base"
                  value={
                    index === 0 ? gramsToKg(set[field]) : (set[field] ?? '')
                  }
                  onChange={(event) =>
                    patch({
                      [field]:
                        index === 0
                          ? kgToGrams(event.target.value)
                          : optionalInteger(event.target.value),
                    })
                  }
                />
              </label>
            ),
          )}
        </div>
      </div>
      <p className="mb-1 text-xs font-bold">セット後の実績</p>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
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
            max="2000"
            step="0.001"
            value={gramsToKg(set.actualLoadGrams)}
            onChange={(event) =>
              patch({ actualLoadGrams: kgToGrams(event.target.value) })
            }
            className="mt-1 h-11 min-w-0 text-lg font-black"
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
            min="1"
            step="1"
            max="999"
            value={set.actualReps ?? ''}
            onChange={(event) =>
              patch({ actualReps: optionalInteger(event.target.value) })
            }
            className="mt-1 h-11 min-w-0 text-lg font-black"
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
      {!canComplete &&
        set.actualLoadGrams !== null &&
        set.actualReps !== null && (
          <p className="mt-2 text-xs text-destructive" aria-live="polite">
            重量は0〜2000kg、回数は1〜999の整数で入力してください。
          </p>
        )}
      {canComplete &&
        set.targetLoadGrams !== null &&
        set.targetRepMin !== null && (
          <p className="mt-2 text-xs font-bold">
            {completed ? '今回の結果' : '入力中の実績'}：
            {set.actualLoadGrams! >= set.targetLoadGrams &&
            set.actualReps! >= set.targetRepMin
              ? '目標下限を達成'
              : '目標下限まであと一歩'}
            {set.targetRepMax !== null &&
            set.actualLoadGrams! >= set.targetLoadGrams &&
            set.actualReps! >= set.targetRepMax
              ? ' · 上限回数も達成'
              : ''}
          </p>
        )}
      {comparison.label && (
        <p
          aria-live="polite"
          className={cn(
            'mt-2 text-[11px] font-bold',
            comparison.status === 'above' && 'text-emerald-700',
            comparison.status === 'equal' && 'text-muted-foreground',
            comparison.status === 'below' && 'text-amber-700',
          )}
        >
          {comparison.label}
        </p>
      )}
      <div className="mt-3">
        <label htmlFor={fieldId('memo')} className="text-xs font-bold">
          今回のセットメモ
        </label>
        <Textarea
          id={fieldId('memo')}
          aria-label={`セット${number}のメモ`}
          value={set.memo}
          maxLength={2000}
          onChange={(event) => patch({ memo: event.target.value })}
          placeholder="フォームや違和感など、このセットのメモ"
          className="mt-2 min-h-16 resize-none bg-background"
        />
      </div>
    </div>
  );
}

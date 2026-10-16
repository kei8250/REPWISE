'use client';

import { useRef, useState } from 'react';
import type { ExerciseHistoryEntry } from '@/lib/workouts/history';
import { validReferenceSet, targetFromReference } from '@/lib/workouts/history';
import { ArrowDown, ArrowUp, Check, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ValidatedNumberInput,
  reportInvalidWorkoutInput,
} from './validated-number-input';
import {
  editTargetRange,
  minimumSideReps,
  type RepMode,
} from '@/lib/workouts/reps';
import { Textarea } from '@/components/ui/textarea';
import type { WorkoutSet } from '@/lib/workouts/types';
import { setAchievementLabel } from '@/lib/progression/active-workout';
import {
  setRoleLabel,
  loadBasisLabel,
  loadBasisHelp,
} from '@/lib/workouts/reps';
import type { SetComparison } from '@/lib/progression/active-workout';
import { cn } from '@/lib/utils';
import { setPerformanceLabel } from '@/lib/workouts/history';

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
  repMode = 'standard',
  instant = false,
}: {
  instant?: boolean;
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
  repMode?: RepMode;
  historyStatus?: 'loading' | 'success' | 'error';
}) {
  const root = useRef<HTMLDivElement>(null);
  const [rangeNotice, setRangeNotice] = useState<string | null>(null);
  const perSide = repMode === 'per_side';
  const [editing, setEditing] = useState(instant);
  const completed = set.status === 'completed';
  const patch = (values: Partial<WorkoutSet>) => {
    const next = { ...set, ...values, updatedAt: new Date().toISOString() };
    if (
      ('actualLoadGrams' in values ||
        'actualReps' in values ||
        'actualRepsLeft' in values ||
        'actualRepsRight' in values) &&
      next.status === 'completed' &&
      (next.actualLoadGrams === null ||
        next.actualReps === null ||
        (perSide &&
          (next.actualRepsLeft == null || next.actualRepsRight == null)))
    ) {
      next.status = 'planned';
      next.completedAt = null;
    }
    onChange(next);
  };
  const canComplete =
    set.actualLoadGrams !== null &&
    Number.isInteger(set.actualLoadGrams) &&
    set.actualLoadGrams >= 0 &&
    set.actualLoadGrams <= 2_000_000 &&
    set.actualReps !== null &&
    Number.isInteger(set.actualReps) &&
    set.actualReps > 0 &&
    set.actualReps <= 999 &&
    (!perSide ||
      [set.actualRepsLeft, set.actualRepsRight].every(
        (value) =>
          Number.isInteger(value) && (value ?? 0) >= 1 && (value ?? 0) <= 999,
      ));
  const achievement = setAchievementLabel(set);
  const fieldId = (field: string) => `${set.id}-${field}`;
  if (set.status === 'skipped' && !editing)
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm">
        <p>
          SET {number} · {setRoleLabel(set.role)} · 未実施（スキップ）
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => patch({ status: 'planned', completedAt: null })}
        >
          このセットを入力する
        </Button>
      </div>
    );
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
            {achievement}
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
      ref={root}
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
      {!instant && completed && (
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          編集を閉じる
        </Button>
      )}
      <div className="mb-3 rounded-xl bg-primary/5 px-3 py-2 text-xs">
        <label
          htmlFor={fieldId('role')}
          className="mb-2 block text-xs font-bold"
        >
          セットの役割（同じ役割の前回実績と比較）
        </label>
        <select
          id={fieldId('role')}
          aria-label={`セット${number}の役割`}
          value={set.role ?? 'standard'}
          onChange={(event) =>
            patch({
              role:
                event.target.value === 'top'
                  ? 'top'
                  : event.target.value === 'backoff'
                    ? 'backoff'
                    : 'standard',
            })
          }
          className="mb-3 min-h-11 w-full rounded-lg border bg-background px-3 text-base"
        >
          <option value="standard">通常（セット順で比較）</option>
          <option value="top">トップセット</option>
          <option value="backoff">バックオフセット</option>
        </select>
        {perSide && (
          <p className="mb-3 leading-relaxed text-muted-foreground">
            {loadBasisHelp(set.loadBasis)}
          </p>
        )}
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
                      ? '（入力なし）'
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
              <div key={field} className="min-w-0 text-xs">
                <label htmlFor={fieldId(field)}>
                  {['目標kg', '回数の下限', '回数の上限'][index]}
                </label>
                <ValidatedNumberInput
                  id={fieldId(field)}
                  aria-label={`セット${number}の${['目標重量', '目標回数の下限', '目標回数の上限'][index]}`}
                  min={0}
                  max={index === 0 ? 2000 : 999}
                  scale={index === 0 ? 1000 : 1}
                  className="mt-1 h-11 min-w-0 text-base"
                  value={set[field]}
                  onValueChange={(value) => {
                    if (field === 'targetLoadGrams') {
                      patch({ targetLoadGrams: value });
                      return;
                    }
                    const next = editTargetRange(set, field, value);
                    setRangeNotice(
                      next.targetRepMin !== set.targetRepMin &&
                        field === 'targetRepMax'
                        ? '下限を上限に合わせて調整しました'
                        : next.targetRepMax !== set.targetRepMax &&
                            field === 'targetRepMin'
                          ? '上限を下限に合わせて調整しました'
                          : null,
                    );
                    patch(next);
                  }}
                />
              </div>
            ),
          )}
        </div>
      </div>
      {rangeNotice && (
        <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
          {rangeNotice}
        </p>
      )}
      {set.targetRepMin !== null &&
        set.targetRepMax !== null &&
        set.targetRepMin > set.targetRepMax && (
          <div className="mb-2 rounded-xl border border-amber-300 p-2 text-xs">
            <p>
              保存済みの目標が下限＞上限です。同期は止めずに保持しています。
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-1 min-h-11"
              onClick={() =>
                patch({
                  targetRepMin: set.targetRepMax,
                  targetRepMax: set.targetRepMin,
                })
              }
            >
              下限と上限を入れ替える
            </Button>
          </div>
        )}
      <p className="mb-1 text-xs font-bold">実際に行った重量・回数</p>
      {perSide && (
        <p className="mb-2 text-xs text-muted-foreground">
          重量は共通、目標回数は左右それぞれ。進行判定は少ない側の回数を使います。
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <div className={perSide ? 'col-span-3' : ''}>
          <label
            htmlFor={fieldId('actual-load')}
            className="text-xs font-semibold text-muted-foreground"
          >
            重量（kg）
            {perSide ? ` · 左右共通・${loadBasisLabel(set.loadBasis)}` : ''}
          </label>
          <ValidatedNumberInput
            id={fieldId('actual-load')}
            aria-label={`セット${number}の実績重量`}
            required={
              set.actualReps !== null ||
              set.actualRepsLeft != null ||
              set.actualRepsRight != null
            }
            min={0}
            max={2000}
            scale={1000}
            value={set.actualLoadGrams}
            onValueChange={(value) => patch({ actualLoadGrams: value })}
            className="mt-1 h-11 min-w-0 text-lg font-black"
          />
        </div>
        {(perSide
          ? (['actualRepsRight', 'actualRepsLeft'] as const)
          : (['actualReps'] as const)
        ).map((field) => (
          <div key={field}>
            <label
              htmlFor={fieldId(field)}
              className="text-xs font-semibold text-muted-foreground"
            >
              {field === 'actualRepsRight'
                ? '右の回数'
                : field === 'actualRepsLeft'
                  ? '左の回数'
                  : '回数'}
            </label>
            <ValidatedNumberInput
              id={fieldId(field)}
              aria-label={`セット${number}の${field === 'actualRepsRight' ? '右回数' : field === 'actualRepsLeft' ? '左回数' : '回数'}`}
              required={
                set.actualLoadGrams !== null ||
                set.actualRepsLeft != null ||
                set.actualRepsRight != null
              }
              min={1}
              max={999}
              value={set[field] ?? null}
              onValueChange={(value) => {
                const next = { ...set, [field]: value };
                patch(
                  perSide
                    ? {
                        ...next,
                        actualReps: minimumSideReps(
                          next.actualRepsLeft,
                          next.actualRepsRight,
                        ),
                      }
                    : { actualReps: value },
                );
              }}
              className="mt-1 h-11 min-w-0 text-lg font-black"
            />
          </div>
        ))}
        {!instant && (
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
            onClick={() => {
              if (reportInvalidWorkoutInput(root.current)) return;
              setEditing(false);
              patch(
                completed
                  ? { status: 'planned', completedAt: null }
                  : {
                      status: 'completed',
                      completedAt: new Date().toISOString(),
                    },
              );
            }}
          >
            {completed ? <RotateCcw /> : <Check />}
          </Button>
        )}
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
            {completed ? '今回の結果' : '入力中の実績'}：{achievement}
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

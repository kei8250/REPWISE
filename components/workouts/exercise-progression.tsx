'use client';

import { progressionReasonLabel } from '@/lib/progression/completion-summary';
import { ProgressionEvidence } from './progression-evidence';
import { History, LoaderCircle, RefreshCw, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildActiveProgressionSummary,
  applySuggestionToEmptyTargets,
  formatLoadGrams,
  type StoredTargetSummary,
} from '@/lib/progression/active-workout';
import type { ExerciseProgressionLoadState } from '@/hooks/use-exercise-progression';
import type { ProgressionTarget } from '@/lib/progression/engine';
import type { WorkoutExercise } from '@/lib/workouts/types';

function shortDate(localDate: string) {
  const [, month, day] = localDate.split('-').map(Number);
  return month && day ? `${month}/${day}` : localDate;
}

function targetLabel(
  target: ProgressionTarget | Extract<StoredTargetSummary, { kind: 'uniform' }>,
) {
  return `${formatLoadGrams(target.loadGrams)} / ${target.repMin}〜${target.repMax}回 × ${target.workingSets}セット`;
}

export function ExerciseProgression({
  exercise,
  state,
  onRetry,
  onChange,
}: {
  exercise: WorkoutExercise;
  state: ExerciseProgressionLoadState;
  onRetry: () => void;
  onChange?: (exercise: WorkoutExercise) => void;
}) {
  const targets = (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs font-bold">今回の保存済み目標 · セット別</p>
      <ul className="mt-2 space-y-1 text-sm">
        {exercise.sets.map((set) => (
          <li key={set.id}>
            SET {set.position + 1} ·{' '}
            {set.targetLoadGrams === null
              ? '重量未設定'
              : `${set.targetLoadGrams / 1000} kg`}{' '}
            × {set.targetRepMin ?? '—'}〜{set.targetRepMax ?? '—'}回
            {set.setType !== 'working' ? '（ウォームアップ）' : ''}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        目標は実績に入りません。セット後に実際の重量・回数を入力してください。
      </p>
    </div>
  );
  if (state.status === 'idle') return targets;
  if (state.status === 'loading') {
    return (
      <div>
        {targets}
        <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          おすすめ目標を確認中
        </div>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div>
        {targets}
        <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <span>おすすめ目標を取得できませんでした</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onRetry}
            className="shrink-0"
          >
            <RefreshCw /> 再試行
          </Button>
        </div>
      </div>
    );
  }

  const summary = buildActiveProgressionSummary(exercise, state.recommendation);
  return (
    <div className="space-y-2">
      {targets}
      <aside className="grid gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
            <History className="size-3.5" /> 目標の参考実績
            {summary.previous && (
              <span className="font-normal">
                {shortDate(summary.previous.localDate)}
              </span>
            )}
          </p>
          {summary.previous ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="font-black">{summary.previous.loadLabel}</span>
              <span className="text-sm font-bold">
                {summary.previous.repsLabel}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold">参考記録なし</p>
          )}
        </div>
        <div className="min-w-0 border-t pt-2 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
            <Target className="size-3.5" /> 自動提案（採用は任意）
          </p>
          <p className="mt-1 text-sm font-black">
            {summary.suggestion
              ? targetLabel(summary.suggestion)
              : '自動提案を保留'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            参照：
            {state.recommendation.performance?.workoutLocalDate ??
              '有効な完了実績なし'}
            。提案は既存の目標へ自動反映されません。
          </p>
          {summary.suggestion &&
            onChange &&
            exercise.sets.some(
              (set) =>
                set.status === 'planned' &&
                set.setType === 'working' &&
                set.targetLoadGrams === null &&
                set.targetRepMin === null &&
                set.targetRepMax === null &&
                summary.suggestion?.sets.some(
                  (target) => target.position === set.position,
                ),
            ) && (
              <Button
                type="button"
                variant="outline"
                className="mt-2 min-h-11 w-full whitespace-normal"
                onClick={() => {
                  if (summary.suggestion)
                    onChange({
                      ...applySuggestionToEmptyTargets(
                        exercise,
                        summary.suggestion,
                      ),
                      updatedAt: new Date().toISOString(),
                    });
                }}
              >
                空欄セットの目標に提案を採用
              </Button>
            )}
        </div>
      </aside>
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer py-2 text-xs font-bold">
          自動提案の根拠 ·{' '}
          {progressionReasonLabel(state.recommendation.decision.reasonCode)}
        </summary>
        <ProgressionEvidence
          performance={state.recommendation.performance}
          profile={state.recommendation.profile}
        />
      </details>
    </div>
  );
}

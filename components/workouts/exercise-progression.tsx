'use client';

import { History, LoaderCircle, RefreshCw, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildActiveProgressionSummary,
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
}: {
  exercise: WorkoutExercise;
  state: ExerciseProgressionLoadState;
  onRetry: () => void;
}) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        前回記録を確認中
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        <span>前回記録を取得できませんでした</span>
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
    );
  }

  const summary = buildActiveProgressionSummary(exercise, state.recommendation);
  return (
    <aside className="grid gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-2">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
          <History className="size-3.5" /> 前回実績
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
          <p className="mt-1 text-sm font-semibold">前回記録なし</p>
        )}
      </div>
      <div className="min-w-0 border-t pt-2 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
        <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
          <Target className="size-3.5" /> 今日の目標
        </p>
        <p className="mt-1 text-sm font-black">
          {summary.storedTarget?.kind === 'uniform'
            ? targetLabel(summary.storedTarget)
            : summary.storedTarget?.kind === 'set_specific'
              ? '保存済み目標は各セットに設定済み'
              : summary.suggestion
                ? targetLabel(summary.suggestion)
                : 'おすすめ目標なし'}
        </p>
        {summary.showSeparateSuggestion && summary.suggestion && (
          <p className="mt-1 text-xs font-semibold text-primary">
            おすすめ {targetLabel(summary.suggestion)}
          </p>
        )}
      </div>
    </aside>
  );
}

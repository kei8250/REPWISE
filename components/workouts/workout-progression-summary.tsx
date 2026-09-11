'use client';

import { CircleHelp, LoaderCircle, Minus, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useWorkoutCompletionProgression } from '@/hooks/use-workout-completion-progression';
import {
  formatNextProgressionTarget,
  formatWorkingSetPerformance,
  progressionReasonLabel,
  progressionStatusLabel,
} from '@/lib/progression/completion-summary';

export function WorkoutProgressionSummary({
  workoutId,
  workoutVersion,
}: {
  workoutId: string;
  workoutVersion: number;
}) {
  const { state, retry } = useWorkoutCompletionProgression(
    workoutId,
    workoutVersion,
    true,
  );

  return (
    <Card
      className="rounded-3xl py-5 shadow-none"
      aria-label="今回のトレーニング評価"
    >
      <CardContent className="px-5">
        <div>
          <p className="text-xs font-bold text-primary">PROGRESSION</p>
          <h2 className="mt-1 text-xl font-black">今回の評価</h2>
        </div>

        {state.status === 'success' ? (
          <>
            <div className="mt-4 rounded-2xl bg-muted/65 p-4">
              <p className="text-sm font-black">
                {state.summary.totalExercises}種目中
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-muted-foreground">
                <span>
                  {state.summary.counts.increaseLoad}種目：重量アップ候補
                </span>
                <span>{state.summary.counts.keepLoad}種目：同重量継続</span>
                {state.summary.counts.insufficientData > 0 && (
                  <span>
                    {state.summary.counts.insufficientData}種目：判定不能
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2 divide-y">
              {state.summary.exercises.map((exercise) => {
                const nextTarget = formatNextProgressionTarget(
                  exercise.decision,
                );
                const Icon =
                  exercise.decision.status === 'increase_load'
                    ? TrendingUp
                    : exercise.decision.status === 'keep_load'
                      ? Minus
                      : CircleHelp;
                return (
                  <div
                    key={exercise.workoutExerciseId}
                    className="py-4 first:pt-3 last:pb-0"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${exercise.decision.status === 'increase_load' ? 'bg-emerald-100 text-emerald-800' : exercise.decision.status === 'keep_load' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-black">{exercise.exerciseName}</h3>
                        <p className="mt-1 text-sm font-bold">
                          {formatWorkingSetPerformance(exercise.performance)}
                        </p>
                        <p className="mt-2 text-sm font-black">
                          {progressionStatusLabel(exercise.decision.status)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {progressionReasonLabel(exercise.decision.reasonCode)}
                        </p>
                        {nextTarget && (
                          <p className="mt-2 text-xs font-bold text-primary">
                            次回候補 {nextTarget}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : state.status === 'error' ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/65 p-3">
            <p className="text-sm text-muted-foreground">{state.error}</p>
            <Button type="button" variant="ghost" size="sm" onClick={retry}>
              再試行
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            評価を確認中
          </div>
        )}
      </CardContent>
    </Card>
  );
}

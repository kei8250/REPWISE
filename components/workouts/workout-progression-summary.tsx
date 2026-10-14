'use client';

import { ProgressionEvidence } from './progression-evidence';
import { useRef, useState } from 'react';
import {
  Check,
  CircleHelp,
  LoaderCircle,
  Minus,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useWorkoutCompletionProgression } from '@/hooks/use-workout-completion-progression';
import {
  formatNextProgressionTarget,
  formatWorkingSetPerformance,
  progressionReasonLabel,
  progressionStatusLabel,
} from '@/lib/progression/completion-summary';
import {
  achievedPersonalRecordLabels,
  formatE1rmKg,
  formatVolumeKg,
} from '@/lib/progression/personal-records';
import type { AcceptedNextTargetSummary } from '@/lib/progression/accepted-next-target';
import {
  stagnationReasonLabel,
  stagnationStatusLabel,
} from '@/lib/progression/stagnation';
import { acceptWorkoutNextTarget } from '@/lib/workouts/api-client';

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
  const [acceptedOverrides, setAcceptedOverrides] = useState<
    Record<string, AcceptedNextTargetSummary>
  >({});
  const [acceptingExerciseId, setAcceptingExerciseId] = useState<string | null>(
    null,
  );
  const [acceptErrors, setAcceptErrors] = useState<Record<string, string>>({});
  const mutationIds = useRef(new Map<string, string>());

  async function acceptTarget(exerciseId: string) {
    if (state.status !== 'success' || acceptingExerciseId) return;
    const key = `${state.summary.workoutId}:${state.summary.workoutVersion}:${exerciseId}`;
    let mutationId = mutationIds.current.get(key);
    if (!mutationId) {
      mutationId = crypto.randomUUID();
      mutationIds.current.set(key, mutationId);
    }
    setAcceptingExerciseId(exerciseId);
    setAcceptErrors((current) => ({ ...current, [exerciseId]: '' }));
    try {
      const result = await acceptWorkoutNextTarget({
        mutationId,
        exerciseId,
        sourceWorkoutId: state.summary.workoutId,
        sourceWorkoutVersion: state.summary.workoutVersion,
      });
      setAcceptedOverrides((current) => ({
        ...current,
        [exerciseId]: result.target,
      }));
    } catch (cause) {
      setAcceptErrors((current) => ({
        ...current,
        [exerciseId]:
          cause instanceof Error
            ? cause.message
            : '次回目標を保存できませんでした',
      }));
    } finally {
      setAcceptingExerciseId(null);
    }
  }

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
                const personalRecordLabels = achievedPersonalRecordLabels(
                  exercise.personalRecords,
                );
                const Icon =
                  exercise.decision.status === 'increase_load'
                    ? TrendingUp
                    : exercise.decision.status === 'keep_load'
                      ? Minus
                      : CircleHelp;
                const accepted =
                  acceptedOverrides[exercise.exerciseId] ??
                  exercise.acceptedNextTarget;
                const acceptedHere =
                  accepted?.sourceWorkoutId === state.summary.workoutId;
                const isAccepted =
                  acceptedHere &&
                  accepted?.status === 'accepted' &&
                  accepted.validity === 'valid' &&
                  accepted.sourceWorkoutVersion ===
                    state.summary.workoutVersion;
                const isApplied =
                  acceptedHere && accepted?.status === 'applied';
                const isStale = acceptedHere && accepted?.validity !== 'valid';
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
                        {(exercise.personalRecords.current.maxE1rmGrams !==
                          null ||
                          exercise.personalRecords.current
                            .totalVolumeGramReps !== null) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {exercise.personalRecords.current.maxE1rmGrams !==
                              null && (
                              <>
                                e1RM{' '}
                                {formatE1rmKg(
                                  exercise.personalRecords.current.maxE1rmGrams,
                                )}
                              </>
                            )}
                            {exercise.personalRecords.current.maxE1rmGrams !==
                              null &&
                              exercise.personalRecords.current
                                .totalVolumeGramReps !== null &&
                              ' · '}
                            {exercise.personalRecords.current
                              .totalVolumeGramReps !== null && (
                              <>
                                ボリューム{' '}
                                {formatVolumeKg(
                                  exercise.personalRecords.current
                                    .totalVolumeGramReps,
                                )}
                              </>
                            )}
                          </p>
                        )}
                        <p className="mt-2 text-sm font-black">
                          今回の自動判定：{progressionStatusLabel(exercise.decision.status)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {progressionReasonLabel(exercise.decision.reasonCode)}
                        </p>
                        <ProgressionEvidence performance={exercise.performance} profile={exercise.profile} />
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                          <span
                            className={`font-black ${exercise.stagnation.status === 'progressing' ? 'text-emerald-700' : exercise.stagnation.status === 'stagnating' ? 'text-amber-700' : 'text-muted-foreground'}`}
                          >
                            複数回の傾向：
                            {stagnationStatusLabel(exercise.stagnation.status)}
                          </span>
                          <span className="text-muted-foreground">
                            {stagnationReasonLabel(exercise.stagnation)}
                          </span>
                        </div>
                        {exercise.personalRecords.status === 'first_record' ? (
                          <Badge variant="secondary" className="mt-2">
                            初回記録
                          </Badge>
                        ) : personalRecordLabels.length > 0 ? (
                          <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-950">
                            PR: {personalRecordLabels.join(' / ')}
                          </p>
                        ) : null}
                        {acceptedHere && accepted && accepted.status !== 'superseded' && (
                          <div className="mt-3 rounded-xl border border-primary/30 p-3 text-xs">
                            <p className="font-bold">ユーザーが確定した次回目標{isApplied ? '（適用済み）' : ''}</p>
                            <p className="mt-1">{accepted.targetLoadGrams / 1000}kg / {accepted.targetRepMin}〜{accepted.targetRepMax}回 × {accepted.targetWorkingSets}セット</p>
                            <p className="mt-1 text-muted-foreground">確定値は保持されます。下の自動提案は現在の種目設定による再計算です。</p>
                            {isStale && <p className="mt-1 text-amber-700">元の記録が変更されています。目標を再確認してください。</p>}
                          </div>
                        )}
                        {nextTarget && (
                          <div className="mt-2">
                            <p className="text-xs font-bold text-primary">
                              自動提案（未確定） {nextTarget}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">参照：{exercise.performance.workoutLocalDate}の実績。確定操作までは既存の次回目標を変更しません。</p>
                            {isAccepted ? (
                              <p className="mt-2 inline-flex items-center gap-1 text-xs font-black text-emerald-700">
                                <Check className="size-3.5" />
                                次回目標に設定済み
                              </p>
                            ) : isApplied ? (
                              <p className="mt-2 inline-flex items-center gap-1 text-xs font-black text-muted-foreground">
                                <Check className="size-3.5" />
                                次回Workoutへ適用済み
                              </p>
                            ) : (
                              <>
                                {isStale && (
                                  <p className="mt-2 text-xs font-bold text-amber-700">
                                    元の記録が変更されたため、次回目標を再確認してください
                                  </p>
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="mt-2 min-h-11"
                                  disabled={acceptingExerciseId !== null}
                                  onClick={() =>
                                    void acceptTarget(exercise.exerciseId)
                                  }
                                >
                                  {acceptingExerciseId ===
                                    exercise.exerciseId && (
                                    <LoaderCircle className="animate-spin" />
                                  )}
                                  {isStale
                                    ? '次回目標を再設定'
                                    : '次回目標に設定'}
                                </Button>
                              </>
                            )}
                            {acceptErrors[exercise.exerciseId] && (
                              <p
                                role="alert"
                                className="mt-2 text-xs font-bold text-destructive"
                              >
                                {acceptErrors[exercise.exerciseId]}
                              </p>
                            )}
                          </div>
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

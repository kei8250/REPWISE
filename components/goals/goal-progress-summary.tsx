'use client';

import { useGoalProgress } from '@/hooks/use-goal-progress';
import { goalProgress } from '@/lib/goals/model';
import { APP_ROUTES } from '@/lib/routes';
import { formatKilograms } from '@/lib/analytics/detail-view';
import { effectiveLoadGrams, effectiveReps } from '@/lib/workouts/reps';
import type { WorkoutExercise } from '@/lib/workouts/types';

const kg = (value: number) => formatKilograms(value, 2);

export function HomeGoalProgress() {
  const state = useGoalProgress();
  return (
    <section
      aria-labelledby="home-goals-title"
      className="rounded-3xl border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="home-goals-title" className="text-lg font-black">
          目標への達成度
        </h2>
        <a
          className="inline-flex min-h-11 items-center text-sm font-bold text-primary"
          href={APP_ROUTES.goals}
        >
          目標設定へ →
        </a>
      </div>
      {state.storageError ? (
        <p role="alert" className="text-sm">
          目標を読み込めません。目標設定で保存状態を確認してください。
        </p>
      ) : state.goals.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          3か月・半年・1年先の目標を設定して、成長を確認しましょう。
        </p>
      ) : (
        <div className="divide-y">
          {state.goals
            .sort((a, b) => a.deadline.localeCompare(b.deadline))
            .slice(0, 3)
            .map((goal) => {
              const progress = state.data
                ? goalProgress(
                    goal,
                    state.data.exercises.find(
                      (e) => e.exerciseId === goal.exerciseId,
                    )?.repTrend ?? [],
                    state.today,
                  )
                : null;
              return (
                <a
                  key={goal.id}
                  className="block space-y-2 py-4"
                  href={APP_ROUTES.goals}
                >
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <strong>{goal.exerciseName}</strong>
                    <span>
                      {goal.status === 'paused'
                        ? '一時停止中'
                        : progress?.achieved
                          ? '目標達成！'
                          : progress
                            ? `${progress.percent}%`
                            : '実績を確認中…'}
                    </span>
                  </div>
                  <p className="text-sm">
                    目標 {kg(goal.targetLoadGrams)} × {goal.targetReps}回 ·{' '}
                    {goal.deadline}まで
                  </p>
                  {progress && (
                    <>
                      <progress
                        className="h-2 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                        aria-label={`${goal.exerciseName}の目標達成度`}
                        value={progress.percent}
                        max={100}
                      />
                      <p className="text-xs text-muted-foreground">
                        {progress.actual
                          ? `現在 ${kg(progress.currentLoadGrams)} × ${progress.actual.bestReps}回`
                          : `開始値 ${kg(progress.currentLoadGrams)}（開始後の実績なし）`}{' '}
                        · あと{kg(progress.remainingGrams)}
                      </p>
                    </>
                  )}
                </a>
              );
            })}
          {state.goals.length > 3 && (
            <a
              className="inline-flex min-h-11 items-center text-sm font-bold text-primary"
              href={APP_ROUTES.goals}
            >
              すべての目標を見る（{state.goals.length}件）
            </a>
          )}
        </div>
      )}
      {state.error && (
        <div role="alert" className="text-sm">
          実績を取得できませんでした。
          <button
            className="min-h-11 px-3 font-bold text-primary"
            onClick={state.retry}
          >
            再取得
          </button>
        </div>
      )}
    </section>
  );
}

export function WorkoutGoalProgress({
  exercise,
  localDate,
  workoutId,
}: {
  exercise: WorkoutExercise;
  localDate: string;
  workoutId: string;
}) {
  const state = useGoalProgress(exercise.exerciseId);
  const goal = state.goals[0];
  if (state.storageError)
    return (
      <p className="text-xs text-muted-foreground">
        長期目標を読み込めません。目標設定で保存状態を確認してください。
      </p>
    );
  if (!goal) return null;
  const points =
    state.data?.exercises
      .find((e) => e.exerciseId === exercise.exerciseId)
      ?.repTrend.filter((p) => p.workoutId !== workoutId) ?? [];
  const progress = state.data ? goalProgress(goal, points, state.today) : null;
  const draftPoints = exercise.sets
    .filter(
      (s) =>
        s.status === 'completed' &&
        s.setType === 'working' &&
        (effectiveLoadGrams(s) ?? 0) > 0 &&
        (effectiveReps(s) ?? 0) > 0,
    )
    .map((s) => ({
      workoutId,
      localDate,
      loadGrams: effectiveLoadGrams(s)!,
      bestReps: effectiveReps(s)!,
    }));
  const preview =
    progress && draftPoints.length
      ? goalProgress(goal, [...points, ...draftPoints], state.today)
      : null;
  return (
    <section
      className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"
      aria-label="この種目の長期目標"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="text-sm font-black">
          長期目標 {kg(goal.targetLoadGrams)} × {goal.targetReps}回
        </h3>
        <a className="text-sm font-bold text-primary" href={APP_ROUTES.goals}>
          目標設定
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        {goal.deadline}まで{goal.status === 'paused' ? ' · 一時停止中' : ''}
      </p>
      {progress ? (
        <>
          <p className="text-sm">
            保存済みの達成度 <strong>{progress.percent}%</strong> · あと
            {kg(progress.remainingGrams)}
          </p>
          <progress
            className="h-2 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
            aria-label="保存済みの目標進捗"
            value={progress.percent}
            max={100}
          />
          {goal.status === 'active' && !progress.achieved && (
            <p className="text-sm">
              {progress.overdue
                ? '期限を迎えています。目標設定で計画を見直せます。'
                : `${progress.milestone.date}までに ${kg(progress.milestone.loadGrams)} × ${goal.targetReps}回が目安。今の実績からあと${kg(progress.monthlyIncreaseGrams)}。`}
            </p>
          )}
          {preview && (
            <output className="block text-sm font-bold text-primary">
              今回の完了セットを含む見込み：{preview.percent}%
              {preview.achieved ? ' · 目標条件を達成！' : ''}
              （ワークアウト保存前）
            </output>
          )}
          <p className="text-xs text-muted-foreground">
            月末の重量は計画上の目安です。無理に増量せず、フォームや体調に合わせて調整してください。
          </p>
        </>
      ) : state.error ? (
        <p role="alert" className="text-sm">
          進捗を取得できませんでした。
          <button onClick={state.retry} className="min-h-11 px-2 font-bold">
            再取得
          </button>
        </p>
      ) : (
        <p className="text-sm">目標への進捗を確認中…</p>
      )}
    </section>
  );
}

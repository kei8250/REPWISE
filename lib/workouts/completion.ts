import type { Workout } from './types';

export function prepareWorkoutCompletion(
  current: Workout,
  endedAt = new Date().toISOString(),
): Workout {
  if (!current.exercises.length)
    throw new Error('種目を1つ以上追加してください');
  const exercises = current.exercises.map((exercise) => {
    const sets = exercise.sets.map((set) => {
      if (set.status === 'skipped' || exercise.status === 'skipped')
        return { ...set, status: 'skipped' as const };
      if (
        set.actualLoadGrams === null &&
        set.actualReps === null &&
        set.status !== 'completed'
      ) {
        return {
          ...set,
          status: 'skipped' as const,
          completedAt: null,
          updatedAt: endedAt,
        };
      }
      if (
        !Number.isSafeInteger(set.actualLoadGrams) ||
        (set.actualLoadGrams ?? -1) < 0 ||
        (set.actualLoadGrams ?? 0) > 2_000_000 ||
        !Number.isSafeInteger(set.actualReps) ||
        (set.actualReps ?? 0) < 1 ||
        (set.actualReps ?? 0) > 999
      ) {
        throw new Error(
          `${exercise.exerciseNameSnapshot}のセット${set.position + 1}：重量と回数を正しく入力してください。重量は0〜2000kg、回数は1〜999の整数です。`,
        );
      }
      return {
        ...set,
        status: 'completed' as const,
        completedAt: set.completedAt ?? endedAt,
        updatedAt: endedAt,
      };
    });
    const completed = sets.some((set) => set.status === 'completed');
    return {
      ...exercise,
      sets,
      status: completed ? ('completed' as const) : ('skipped' as const),
      completedAt: completed ? (exercise.completedAt ?? endedAt) : null,
      updatedAt: endedAt,
    };
  });
  if (
    !exercises.some((exercise) =>
      exercise.sets.some((set) => set.status === 'completed'),
    )
  ) {
    throw new Error('重量と回数を入力したセットを1つ以上記録してください');
  }
  return {
    ...current,
    exercises,
    status: 'completed',
    endedAt,
    updatedAt: endedAt,
  };
}

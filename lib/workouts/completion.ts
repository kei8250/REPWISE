import { minimumSideReps } from './reps';
import type { Workout, WorkoutExercise } from './types';

export function prepareWorkoutCompletion(
  current: Workout,
  endedAt = new Date().toISOString(),
): Workout {
  if (!current.exercises.length)
    throw new Error('種目を1つ以上追加してください');
  const exercises = current.exercises.map((exercise) =>
    prepareExerciseCompletion(exercise, endedAt),
  );
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

export function prepareExerciseCompletion(
  exercise: WorkoutExercise,
  endedAt = new Date().toISOString(),
): WorkoutExercise {
  const sets = exercise.sets.map((original) => {
    const set =
      exercise.repMode === 'per_side'
        ? {
            ...original,
            actualReps: minimumSideReps(
              original.actualRepsLeft,
              original.actualRepsRight,
            ),
          }
        : original;
    if (set.status === 'skipped' || exercise.status === 'skipped')
      return {
        ...set,
        status: 'skipped' as const,
        completedAt: null,
        updatedAt: endedAt,
      };
    if (
      set.actualLoadGrams === null &&
      set.actualReps === null &&
      set.actualRepsLeft == null &&
      set.actualRepsRight == null &&
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
      exercise.repMode === 'per_side' &&
      [set.actualRepsLeft, set.actualRepsRight].some(
        (value) =>
          !Number.isSafeInteger(value) ||
          (value ?? 0) < 1 ||
          (value ?? 0) > 999,
      )
    )
      throw new Error(
        `${exercise.exerciseNameSnapshot}のセット${set.position + 1}：右と左の回数を1〜999の整数で入力してください。`,
      );
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
}

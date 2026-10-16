import { minimumSideReps } from './reps';
import type { Workout } from './types';

// Preserve every partial field. Only complete, valid actual values enter analytics.
export function normalizeRecordedWorkout(
  workout: Workout,
  timestamp = new Date().toISOString(),
): Workout {
  return {
    ...workout,
    status: 'completed',
    endedAt: workout.endedAt ?? timestamp,
    updatedAt: timestamp,
    exercises: workout.exercises.map((exercise) => {
      const sets = exercise.sets.map((set) => {
        const reps =
          exercise.repMode === 'per_side'
            ? minimumSideReps(set.actualRepsLeft, set.actualRepsRight)
            : set.actualReps;
        const valid =
          set.status !== 'skipped' &&
          Number.isSafeInteger(set.actualLoadGrams) &&
          (set.actualLoadGrams ?? -1) >= 0 &&
          (set.actualLoadGrams ?? 0) <= 2000000 &&
          Number.isSafeInteger(reps) &&
          (reps ?? 0) >= 1 &&
          (reps ?? 0) <= 999 &&
          (exercise.repMode !== 'per_side' ||
            [set.actualRepsLeft, set.actualRepsRight].every(
              (value) =>
                Number.isSafeInteger(value) &&
                (value ?? 0) >= 1 &&
                (value ?? 0) <= 999,
            ));
        return {
          ...set,
          actualReps: reps,
          status: valid
            ? ('completed' as const)
            : set.status === 'skipped'
              ? ('skipped' as const)
              : ('planned' as const),
          completedAt: valid ? (set.completedAt ?? timestamp) : null,
        };
      });
      const recorded = sets.some((set) => set.status === 'completed');
      return {
        ...exercise,
        sets,
        status: recorded ? ('completed' as const) : ('in_progress' as const),
        completedAt: recorded ? (exercise.completedAt ?? timestamp) : null,
      };
    }),
  };
}

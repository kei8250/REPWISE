import type { Workout } from './types';

export type SnapshotReplacementPlan = {
  workout: Workout;
  removedExerciseIds: string[];
  removedSetIds: string[];
};

export function buildSnapshotReplacementPlan(existing: Workout, incoming: Workout): SnapshotReplacementPlan {
  const incomingExerciseIds = new Set(incoming.exercises.map((exercise) => exercise.id));
  const incomingSetIds = new Set(incoming.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id)));
  return {
    workout: {
      ...incoming,
      exercises: [...incoming.exercises]
        .sort((a, b) => a.position - b.position)
        .map((exercise) => ({ ...exercise, sets: [...exercise.sets].sort((a, b) => a.position - b.position) })),
    },
    removedExerciseIds: existing.exercises.filter((exercise) => !incomingExerciseIds.has(exercise.id)).map((exercise) => exercise.id),
    removedSetIds: existing.exercises.flatMap((exercise) => exercise.sets).filter((set) => !incomingSetIds.has(set.id)).map((set) => set.id),
  };
}

import type {
  CreateWorkoutInput,
  ExerciseMaster,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from './types';

export function createLocalWorkout(input: CreateWorkoutInput): Workout {
  const timestamp = input.startedAt ?? new Date().toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    status: 'active',
    localDate: input.localDate,
    timezone: input.timezone,
    startedAt: timestamp,
    endedAt: null,
    overallNote: '',
    rating: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    exercises: [],
  };
}

export function createSet(position: number, previous?: WorkoutSet): WorkoutSet {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    position,
    status: 'planned',
    setType: 'working',
    targetLoadGrams: null,
    targetRepMin: null,
    targetRepMax: null,
    actualLoadGrams: previous?.actualLoadGrams ?? null,
    actualReps: previous?.actualReps ?? null,
    memo: '',
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createWorkoutExercise(
  exercise: ExerciseMaster,
  position: number,
): WorkoutExercise {
  const timestamp = new Date().toISOString();
  const setCount = exercise.defaultWorkingSets ?? 3;
  return {
    id: crypto.randomUUID(),
    exerciseId: exercise.id,
    position,
    status: 'in_progress',
    exerciseNameSnapshot: exercise.name,
    note: '',
    startedAt: timestamp,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    sets: Array.from({ length: setCount }, (_, index) => {
      const set = createSet(index);
      set.targetRepMin = exercise.defaultRepMin;
      set.targetRepMax = exercise.defaultRepMax;
      return set;
    }),
  };
}

export function normalizePositions<T extends { position: number }>(
  items: T[],
): T[] {
  return items.map((item, position) => ({ ...item, position }));
}

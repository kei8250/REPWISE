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
    sourceWorkoutId: null,
    exercises: [],
  };
}

export function copyWorkoutForToday(
  source: Workout,
  options: {
    timestamp?: string;
    localDate?: string;
    timezone?: string;
    idFactory?: () => string;
  } = {},
): Workout {
  if (source.status !== 'completed' || source.deletedAt) {
    throw new Error('削除されていない完了済みワークアウトだけをコピーできます');
  }
  const timestamp = options.timestamp ?? new Date().toISOString();
  const date = new Date(timestamp);
  const localDate =
    options.localDate ??
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const timezone =
    options.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    source.timezone;
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());

  return {
    id: idFactory(),
    name: source.name,
    status: 'active',
    localDate,
    timezone,
    startedAt: timestamp,
    endedAt: null,
    overallNote: '',
    rating: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    sourceWorkoutId: source.id,
    exercises: [...source.exercises]
      .sort((a, b) => a.position - b.position)
      .map((exercise, position) => ({
        id: idFactory(),
        exerciseId: exercise.exerciseId,
        position,
        status: 'in_progress',
        exerciseNameSnapshot: exercise.exerciseNameSnapshot,
        note: exercise.note,
        startedAt: timestamp,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        sets: [...exercise.sets]
          .sort((a, b) => a.position - b.position)
          .map((set, setPosition) => {
            const hasRepTarget =
              set.targetRepMin !== null || set.targetRepMax !== null;
            return {
              id: idFactory(),
              position: setPosition,
              status: 'planned',
              setType: 'working',
              targetLoadGrams:
                set.targetLoadGrams ?? set.actualLoadGrams ?? null,
              targetRepMin: hasRepTarget
                ? set.targetRepMin
                : (set.actualReps ?? null),
              targetRepMax: hasRepTarget
                ? set.targetRepMax
                : (set.actualReps ?? null),
              actualLoadGrams: null,
              actualReps: null,
              memo: '',
              completedAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            } satisfies WorkoutSet;
          }),
      })),
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

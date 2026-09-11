import {
  evaluateProgression,
  type ExerciseProgressionRecommendation,
  type ProgressionExercisePerformance,
  type ProgressionPerformanceSet,
  type ProgressionProfileOverride,
  resolveProgressionProfile,
} from './engine';
import type { ExerciseMaster } from '@/lib/workouts/types';
import { WorkoutNotFoundError } from '@/lib/workouts/validation';
import type {
  WorkoutCompletionProgressionExercise,
  WorkoutCompletionProgressionSummary,
} from './completion-summary';
import {
  evaluatePersonalRecords,
  type PersonalRecordPerformance,
} from './personal-records';

const ownerId = 'default';

type LatestExerciseRow = {
  workout_id: string;
  workout_version: number;
  workout_local_date: string;
  workout_updated_at: string;
  workout_status: string;
  workout_deleted_at: string | null;
  workout_exercise_id: string;
  exercise_id: string;
  exercise_status: string;
};

type PerformanceSetRow = {
  id: string;
  position: number;
  status: string;
  set_type: string;
  actual_load_grams: number | null;
  actual_reps: number | null;
  deleted_at: string | null;
};

type ExerciseMasterRow = {
  id: string;
  name: string;
  normalized_name: string;
  body_part: string;
  measurement_type: string;
  default_rep_min: number | null;
  default_rep_max: number | null;
  default_working_sets: number | null;
  default_increment_grams: number | null;
  default_rest_seconds: number | null;
};

type CompletionWorkoutRow = {
  id: string;
  version: number;
  local_date: string;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  status: string;
  deleted_at: string | null;
};

type CompletionExerciseRow = ExerciseMasterRow & {
  workout_exercise_id: string;
  exercise_id: string;
  position: number;
  exercise_status: string;
};

type CompletionSetRow = PerformanceSetRow & {
  workout_exercise_id: string;
};

type PersonalRecordHistoryRow = PerformanceSetRow & {
  workout_id: string;
  exercise_id: string;
};

async function getExerciseMaster(
  db: D1Database,
  exerciseId: string,
): Promise<ExerciseMaster | null> {
  const row = await db
    .prepare(
      `SELECT id, name, normalized_name, body_part, measurement_type,
              default_rep_min, default_rep_max, default_working_sets,
              default_increment_grams, default_rest_seconds
       FROM exercise_master
       WHERE id = ? AND owner_id = ? AND archived_at IS NULL`,
    )
    .bind(exerciseId, ownerId)
    .first<ExerciseMasterRow>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    bodyPart: row.body_part,
    measurementType: 'weight_reps',
    defaultRepMin:
      row.default_rep_min === null ? null : Number(row.default_rep_min),
    defaultRepMax:
      row.default_rep_max === null ? null : Number(row.default_rep_max),
    defaultWorkingSets:
      row.default_working_sets === null
        ? null
        : Number(row.default_working_sets),
    defaultIncrementGrams:
      row.default_increment_grams === null
        ? null
        : Number(row.default_increment_grams),
    defaultRestSeconds:
      row.default_rest_seconds === null
        ? null
        : Number(row.default_rest_seconds),
  };
}

export async function getLatestCompletedExercisePerformance(
  db: D1Database,
  exerciseId: string,
): Promise<ProgressionExercisePerformance | null> {
  const exercise = await db
    .prepare(
      `SELECT w.id AS workout_id, w.version AS workout_version,
              w.local_date AS workout_local_date,
              w.updated_at AS workout_updated_at, w.status AS workout_status,
              w.deleted_at AS workout_deleted_at,
              we.id AS workout_exercise_id, we.exercise_id,
              we.status AS exercise_status
       FROM workout_exercise we
       JOIN workout w ON w.id = we.workout_id
       WHERE we.exercise_id = ?
         AND we.status = 'completed'
         AND w.owner_id = ?
         AND w.status = 'completed'
         AND w.deleted_at IS NULL
       ORDER BY w.local_date DESC, w.ended_at DESC, w.started_at DESC,
                we.position DESC
       LIMIT 1`,
    )
    .bind(exerciseId, ownerId)
    .first<LatestExerciseRow>();
  if (!exercise) return null;

  const result = await db
    .prepare(
      `SELECT id, position, status, set_type, actual_load_grams,
              actual_reps, deleted_at
       FROM workout_set
       WHERE workout_exercise_id = ? AND deleted_at IS NULL
       ORDER BY position, created_at`,
    )
    .bind(exercise.workout_exercise_id)
    .all<PerformanceSetRow>();
  const sets: ProgressionPerformanceSet[] = result.results.map((set) => ({
    id: set.id,
    position: Number(set.position),
    status: set.status,
    setType: set.set_type,
    actualLoadGrams:
      set.actual_load_grams === null ? null : Number(set.actual_load_grams),
    actualReps: set.actual_reps === null ? null : Number(set.actual_reps),
    deletedAt: set.deleted_at,
  }));
  return {
    workoutId: exercise.workout_id,
    workoutVersion: Number(exercise.workout_version),
    workoutLocalDate: exercise.workout_local_date,
    workoutUpdatedAt: exercise.workout_updated_at,
    workoutStatus: exercise.workout_status,
    workoutDeletedAt: exercise.workout_deleted_at,
    workoutExerciseId: exercise.workout_exercise_id,
    exerciseId: exercise.exercise_id,
    exerciseStatus: exercise.exercise_status,
    sets,
  };
}

export async function getExerciseProgressionRecommendation(
  db: D1Database,
  exerciseId: string,
  override: ProgressionProfileOverride = {},
): Promise<ExerciseProgressionRecommendation> {
  const [exercise, performance] = await Promise.all([
    getExerciseMaster(db, exerciseId),
    getLatestCompletedExercisePerformance(db, exerciseId),
  ]);
  if (!exercise) throw new WorkoutNotFoundError('種目が見つかりません');
  const profile = resolveProgressionProfile(exercise, override);
  return {
    exerciseId,
    profile,
    performance,
    decision: evaluateProgression(performance, profile),
  };
}

export async function getWorkoutCompletionProgressionSummary(
  db: D1Database,
  workoutId: string,
): Promise<WorkoutCompletionProgressionSummary> {
  const workout = await db
    .prepare(
      `SELECT id, version, local_date, started_at, ended_at, updated_at,
              status, deleted_at
       FROM workout
       WHERE id = ? AND owner_id = ? AND status = 'completed'
         AND deleted_at IS NULL`,
    )
    .bind(workoutId, ownerId)
    .first<CompletionWorkoutRow>();
  if (!workout)
    throw new WorkoutNotFoundError('完了済みワークアウトが見つかりません');

  const [exerciseResult, setResult] = await Promise.all([
    db
      .prepare(
        `SELECT we.id AS workout_exercise_id, we.exercise_id, we.position,
                we.status AS exercise_status,
                em.id, em.name, em.normalized_name, em.body_part,
                em.measurement_type, em.default_rep_min, em.default_rep_max,
                em.default_working_sets, em.default_increment_grams,
                em.default_rest_seconds
         FROM workout_exercise we
         JOIN exercise_master em ON em.id = we.exercise_id
         WHERE we.workout_id = ?
         ORDER BY we.position, we.created_at`,
      )
      .bind(workoutId)
      .all<CompletionExerciseRow>(),
    db
      .prepare(
        `SELECT ws.id, ws.workout_exercise_id, ws.position, ws.status,
                ws.set_type, ws.actual_load_grams, ws.actual_reps,
                ws.deleted_at
         FROM workout_set ws
         JOIN workout_exercise we ON we.id = ws.workout_exercise_id
         WHERE we.workout_id = ? AND ws.deleted_at IS NULL
         ORDER BY we.position, ws.position, ws.created_at`,
      )
      .bind(workoutId)
      .all<CompletionSetRow>(),
  ]);

  const setsByExercise = new Map<string, ProgressionPerformanceSet[]>();
  for (const set of setResult.results) {
    const sets = setsByExercise.get(set.workout_exercise_id) ?? [];
    sets.push({
      id: set.id,
      position: Number(set.position),
      status: set.status,
      setType: set.set_type,
      actualLoadGrams:
        set.actual_load_grams === null ? null : Number(set.actual_load_grams),
      actualReps: set.actual_reps === null ? null : Number(set.actual_reps),
      deletedAt: set.deleted_at,
    });
    setsByExercise.set(set.workout_exercise_id, sets);
  }

  const exerciseIds = [
    ...new Set(exerciseResult.results.map((row) => row.exercise_id)),
  ];
  const historyRows: PersonalRecordHistoryRow[] = [];
  if (exerciseIds.length > 0) {
    const placeholders = exerciseIds.map(() => '?').join(', ');
    const currentCompletedAt =
      workout.ended_at ?? workout.updated_at ?? workout.started_at;
    const historyResult = await db
      .prepare(
        `SELECT w.id AS workout_id, we.exercise_id, ws.id, ws.position,
                ws.status, ws.set_type, ws.actual_load_grams, ws.actual_reps,
                ws.deleted_at
         FROM workout_set ws
         JOIN workout_exercise we ON we.id = ws.workout_exercise_id
         JOIN workout w ON w.id = we.workout_id
         WHERE w.owner_id = ?
           AND w.status = 'completed' AND w.deleted_at IS NULL
           AND we.status = 'completed'
           AND ws.status = 'completed' AND ws.set_type = 'working'
           AND ws.deleted_at IS NULL
           AND ws.actual_load_grams > 0 AND ws.actual_reps > 0
           AND we.exercise_id IN (${placeholders})
           AND w.id <> ?
           AND (
             w.local_date < ?
             OR (
               w.local_date = ?
               AND COALESCE(w.ended_at, w.updated_at, w.started_at) < ?
             )
             OR (
               w.local_date = ?
               AND COALESCE(w.ended_at, w.updated_at, w.started_at) = ?
               AND w.id < ?
             )
           )
         ORDER BY w.local_date, w.ended_at, w.id, we.position, ws.position`,
      )
      .bind(
        ownerId,
        ...exerciseIds,
        workout.id,
        workout.local_date,
        workout.local_date,
        currentCompletedAt,
        workout.local_date,
        currentCompletedAt,
        workout.id,
      )
      .all<PersonalRecordHistoryRow>();
    historyRows.push(...historyResult.results);
  }

  const historyByExercise = new Map<string, PersonalRecordPerformance[]>();
  for (const row of historyRows) {
    const performances = historyByExercise.get(row.exercise_id) ?? [];
    let performance = performances.find(
      (candidate) => candidate.workoutId === row.workout_id,
    );
    if (!performance) {
      performance = {
        workoutId: row.workout_id,
        exerciseId: row.exercise_id,
        sets: [],
      };
      performances.push(performance);
    }
    performance.sets.push({
      id: row.id,
      position: Number(row.position),
      status: row.status,
      setType: row.set_type,
      actualLoadGrams:
        row.actual_load_grams === null ? null : Number(row.actual_load_grams),
      actualReps: row.actual_reps === null ? null : Number(row.actual_reps),
      deletedAt: row.deleted_at,
    });
    historyByExercise.set(row.exercise_id, performances);
  }

  const currentRecordSetsByExercise = new Map<
    string,
    ProgressionPerformanceSet[]
  >();
  for (const row of exerciseResult.results) {
    if (row.exercise_status !== 'completed') continue;
    const sets = currentRecordSetsByExercise.get(row.exercise_id) ?? [];
    sets.push(...(setsByExercise.get(row.workout_exercise_id) ?? []));
    currentRecordSetsByExercise.set(row.exercise_id, sets);
  }

  const exercises: WorkoutCompletionProgressionExercise[] =
    exerciseResult.results.map((row) => {
      const master: ExerciseMaster = {
        id: row.id,
        name: row.name,
        normalizedName: row.normalized_name,
        bodyPart: row.body_part,
        measurementType: 'weight_reps',
        defaultRepMin:
          row.default_rep_min === null ? null : Number(row.default_rep_min),
        defaultRepMax:
          row.default_rep_max === null ? null : Number(row.default_rep_max),
        defaultWorkingSets:
          row.default_working_sets === null
            ? null
            : Number(row.default_working_sets),
        defaultIncrementGrams:
          row.default_increment_grams === null
            ? null
            : Number(row.default_increment_grams),
        defaultRestSeconds:
          row.default_rest_seconds === null
            ? null
            : Number(row.default_rest_seconds),
      };
      const performance: ProgressionExercisePerformance = {
        workoutId: workout.id,
        workoutVersion: Number(workout.version),
        workoutLocalDate: workout.local_date,
        workoutUpdatedAt: workout.updated_at,
        workoutStatus: workout.status,
        workoutDeletedAt: workout.deleted_at,
        workoutExerciseId: row.workout_exercise_id,
        exerciseId: row.exercise_id,
        exerciseStatus: row.exercise_status,
        sets: setsByExercise.get(row.workout_exercise_id) ?? [],
      };
      const profile = resolveProgressionProfile(master);
      const personalRecords = evaluatePersonalRecords(
        {
          workoutId: workout.id,
          exerciseId: row.exercise_id,
          sets: currentRecordSetsByExercise.get(row.exercise_id) ?? [],
        },
        historyByExercise.get(row.exercise_id) ?? [],
      );
      return {
        workoutExerciseId: row.workout_exercise_id,
        exerciseId: row.exercise_id,
        exerciseName: row.name,
        position: Number(row.position),
        profile,
        performance,
        decision: evaluateProgression(performance, profile),
        personalRecords,
      };
    });

  return {
    workoutId: workout.id,
    workoutVersion: Number(workout.version),
    totalExercises: exercises.length,
    counts: {
      increaseLoad: exercises.filter(
        (exercise) => exercise.decision.status === 'increase_load',
      ).length,
      keepLoad: exercises.filter(
        (exercise) => exercise.decision.status === 'keep_load',
      ).length,
      insufficientData: exercises.filter(
        (exercise) => exercise.decision.status === 'insufficient_data',
      ).length,
    },
    exercises,
  };
}

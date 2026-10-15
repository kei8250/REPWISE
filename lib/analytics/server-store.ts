import { setMetadata } from '@/lib/workouts/reps';
import {
  buildAnalytics,
  type AnalyticsExerciseHistoryInput,
  type BuildAnalyticsInput,
} from './engine';
import type { AnalyticsRange, AnalyticsSnapshot } from './model';
import {
  resolveProgressionProfile,
  type ProgressionPerformanceSet,
} from '@/lib/progression/engine';
import type { ExerciseMaster } from '@/lib/workouts/types';

const ownerId = 'default';

type WorkoutRow = {
  id: string;
  local_date: string;
};

type PerformanceRow = {
  workout_id: string;
  workout_version: number;
  workout_local_date: string;
  workout_updated_at: string;
  workout_status: string;
  workout_deleted_at: string | null;
  workout_exercise_id: string;
  exercise_id: string;
  exercise_status: string;
  exercise_name: string;
  normalized_name: string;
  body_part: string | null;
  measurement_type: string;
  default_rep_min: number | null;
  default_rep_max: number | null;
  default_working_sets: number | null;
  default_increment_grams: number | null;
  default_rest_seconds: number | null;
  master_load_basis: string;
  set_id: string;
  set_position: number;
  set_status: string;
  set_type: string;
  actual_load_grams: number | null;
  actual_reps: number | null;
  actual_reps_left: number | null;
  actual_reps_right: number | null;
  role: string;
  load_basis: string;
  target_rep_min: number | null;
  target_rep_max: number | null;
  set_deleted_at: string | null;
};

type AcceptedTargetRow = {
  id: string;
  exercise_id: string;
  source_workout_id: string;
  source_workout_version: number;
  source_current_version: number;
  source_workout_status: string;
  source_local_date: string;
  created_at: string;
  updated_at: string;
  source_deleted_at: string | null;
  status: 'accepted' | 'applied' | 'superseded';
  applied_workout_id: string | null;
  applied_workout_status: string | null;
  applied_workout_deleted_at: string | null;
  target_load_grams: number;
  target_rep_min: number;
  target_rep_max: number;
  target_working_sets: number;
};

function numberOrNull(value: number | null) {
  return value === null ? null : Number(value);
}

function masterFromRow(row: PerformanceRow): ExerciseMaster {
  return {
    id: row.exercise_id,
    name: row.exercise_name,
    normalizedName: row.normalized_name,
    bodyPart: row.body_part ?? '',
    measurementType: 'weight_reps',
    ...(row.master_load_basis === 'paired_total' ? { loadBasis: 'paired_total' as const } : {}),
    defaultRepMin: numberOrNull(row.default_rep_min),
    defaultRepMax: numberOrNull(row.default_rep_max),
    defaultWorkingSets: numberOrNull(row.default_working_sets),
    defaultIncrementGrams: numberOrNull(row.default_increment_grams),
    defaultRestSeconds: numberOrNull(row.default_rest_seconds),
  };
}

function localDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function groupExerciseHistory(rows: PerformanceRow[]) {
  const byWorkoutExercise = new Map<string, AnalyticsExerciseHistoryInput>();
  for (const row of rows) {
    const key = `${row.workout_id}\u0000${row.exercise_id}`;
    let item = byWorkoutExercise.get(key);
    if (!item) {
      item = {
        exerciseName: row.exercise_name,
        bodyPart: row.body_part,
        profile: resolveProgressionProfile(masterFromRow(row)),
        performance: {
          workoutId: row.workout_id,
          workoutVersion: Number(row.workout_version),
          workoutLocalDate: row.workout_local_date,
          workoutUpdatedAt: row.workout_updated_at,
          workoutStatus: row.workout_status,
          workoutDeletedAt: row.workout_deleted_at,
          workoutExerciseId: row.workout_exercise_id,
          exerciseId: row.exercise_id,
          exerciseStatus: row.exercise_status,
          sets: [],
        },
      };
      byWorkoutExercise.set(key, item);
    }
    const set: ProgressionPerformanceSet = {
      id: row.set_id,
      position: Number(row.set_position),
      status: row.set_status,
      setType: row.set_type,
      actualLoadGrams: numberOrNull(row.actual_load_grams),
      actualReps: numberOrNull(row.actual_reps),
      ...setMetadata(row),
      targetRepMin: row.target_rep_min, targetRepMax: row.target_rep_max,
      ...(row.actual_reps_left !== null || row.actual_reps_right !== null ? { actualRepsLeft: row.actual_reps_left, actualRepsRight: row.actual_reps_right } : {}),
      deletedAt: row.set_deleted_at,
    };
    item.performance.sets.push(set);
  }
  return [...byWorkoutExercise.values()];
}

// Shared request-scoped input: analytics and coach consume the same reads/rules.
export async function getAnalyticsInput(
  db: D1Database,
  range: AnalyticsRange,
  now = new Date(),
): Promise<BuildAnalyticsInput> {
  const [workoutResult, performanceResult, acceptedTargetResult] =
    await Promise.all([
      db
        .prepare(
          `SELECT id, local_date
           FROM workout
           WHERE owner_id = ? AND status = 'completed' AND deleted_at IS NULL
           ORDER BY local_date, COALESCE(ended_at, updated_at, started_at), id`,
        )
        .bind(ownerId)
        .all<WorkoutRow>(),
      db
        .prepare(
          `SELECT w.id AS workout_id, w.version AS workout_version,
                  w.local_date AS workout_local_date,
                  w.updated_at AS workout_updated_at,
                  w.status AS workout_status,
                  w.deleted_at AS workout_deleted_at,
                  we.id AS workout_exercise_id, we.exercise_id,
                  we.status AS exercise_status,
                  em.name AS exercise_name, em.normalized_name,
                  em.body_part, em.measurement_type,
                  em.default_rep_min, em.default_rep_max,
                  em.default_working_sets, em.default_increment_grams,
                  em.default_rest_seconds, em.load_basis AS master_load_basis,
                  ws.id AS set_id, ws.position AS set_position,
                  ws.status AS set_status, ws.set_type,
                  ws.actual_load_grams, ws.actual_reps, ws.actual_reps_left, ws.actual_reps_right, ws.role, ws.load_basis, ws.target_rep_min, ws.target_rep_max,
                  ws.deleted_at AS set_deleted_at
           FROM workout_set ws
           JOIN workout_exercise we ON we.id = ws.workout_exercise_id
           JOIN workout w ON w.id = we.workout_id
           JOIN exercise_master em ON em.id = we.exercise_id
           WHERE w.owner_id = ?
             AND w.status = 'completed' AND w.deleted_at IS NULL
             AND we.status = 'completed'
             AND ws.status = 'completed' AND ws.set_type = 'working'
             AND ws.deleted_at IS NULL
             AND ws.actual_load_grams > 0 AND ws.actual_reps > 0
           ORDER BY w.local_date,
                    COALESCE(w.ended_at, w.updated_at, w.started_at),
                    w.id, we.position, ws.position, ws.created_at`,
        )
        .bind(ownerId)
        .all<PerformanceRow>(),
      db
        .prepare(
          `SELECT ant.id, ant.exercise_id, ant.source_workout_id,
                  ant.source_workout_version,
                  source.version AS source_current_version,
                  source.status AS source_workout_status,
                  source.local_date AS source_local_date,
                  source.deleted_at AS source_deleted_at,
                  ant.created_at, ant.updated_at,
                  ant.status, ant.applied_workout_id,
                  applied.status AS applied_workout_status,
                  applied.deleted_at AS applied_workout_deleted_at,
                  ant.target_load_grams, ant.target_rep_min,
                  ant.target_rep_max, ant.target_working_sets
           FROM accepted_next_target ant
           JOIN workout source ON source.id = ant.source_workout_id
           LEFT JOIN workout applied ON applied.id = ant.applied_workout_id
           WHERE ant.owner_id = ? AND source.owner_id = ?
           ORDER BY source.local_date, ant.created_at, ant.id`,
        )
        .bind(ownerId, ownerId)
        .all<AcceptedTargetRow>(),
    ]);

  return {
    range,
    today: localDateInTimeZone(now, 'Asia/Tokyo'),
    generatedAt: now.toISOString(),
    workouts: workoutResult.results.map((row) => ({
      id: row.id,
      localDate: row.local_date,
    })),
    exerciseHistory: groupExerciseHistory(performanceResult.results),
    acceptedTargets: acceptedTargetResult.results.map((row) => ({
      id: row.id,
      exerciseId: row.exercise_id,
      sourceWorkoutId: row.source_workout_id,
      sourceWorkoutVersion: Number(row.source_workout_version),
      sourceCurrentVersion: Number(row.source_current_version),
      sourceWorkoutStatus: row.source_workout_status,
      sourceLocalDate: row.source_local_date,
      acceptedAt: row.created_at,
      updatedAt: row.updated_at,
      sourceDeletedAt: row.source_deleted_at,
      status: row.status,
      appliedWorkoutId: row.applied_workout_id,
      appliedWorkoutStatus: row.applied_workout_status,
      appliedWorkoutDeletedAt: row.applied_workout_deleted_at,
      targetLoadGrams: Number(row.target_load_grams),
      targetRepMin: Number(row.target_rep_min),
      targetRepMax: Number(row.target_rep_max),
      targetWorkingSets: Number(row.target_working_sets),
    })),
  };
}

export async function getAnalyticsSnapshot(
  db: D1Database,
  range: AnalyticsRange,
  now = new Date(),
  excludedWorkoutIds: string[] = [],
): Promise<AnalyticsSnapshot> {
  const input = await getAnalyticsInput(db, range, now);
  const excluded = new Set(excludedWorkoutIds);
  input.workouts = input.workouts.filter((item) => !excluded.has(item.id));
  input.exerciseHistory = input.exerciseHistory.filter((item) => !excluded.has(item.performance.workoutId));
  input.acceptedTargets = input.acceptedTargets.filter((item) => !excluded.has(item.sourceWorkoutId)).map((item) => excluded.has(item.appliedWorkoutId ?? '') ? { ...item, appliedWorkoutDeletedAt: now.toISOString() } : item);
  return buildAnalytics(input);
}

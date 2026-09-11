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

const ownerId = 'default';

type LatestExerciseRow = {
  workout_id: string;
  workout_version: number;
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

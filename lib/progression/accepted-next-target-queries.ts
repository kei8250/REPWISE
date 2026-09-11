import type {
  AcceptedNextTargetSummary,
  ApplicableAcceptedTarget,
} from './accepted-next-target';

const ownerId = 'default';

type AcceptedTargetRow = {
  id: string;
  mutation_id: string;
  exercise_id: string;
  source_workout_id: string;
  source_workout_version: number;
  target_load_grams: number;
  target_rep_min: number;
  target_rep_max: number;
  target_working_sets: number;
  status: 'accepted' | 'applied' | 'superseded';
  applied_workout_id: string | null;
  created_at: string;
  updated_at: string;
  current_source_version?: number | null;
  source_deleted_at?: string | null;
};

export function acceptedTargetRowToSummary(
  row: AcceptedTargetRow,
): AcceptedNextTargetSummary {
  const validity = row.source_deleted_at
    ? 'source_deleted'
    : row.current_source_version !== undefined &&
        Number(row.current_source_version) !==
          Number(row.source_workout_version)
      ? 'stale_source_version'
      : 'valid';
  return {
    id: row.id,
    mutationId: row.mutation_id,
    exerciseId: row.exercise_id,
    sourceWorkoutId: row.source_workout_id,
    sourceWorkoutVersion: Number(row.source_workout_version),
    targetLoadGrams: Number(row.target_load_grams),
    targetRepMin: Number(row.target_rep_min),
    targetRepMax: Number(row.target_rep_max),
    targetWorkingSets: Number(row.target_working_sets),
    status: row.status,
    appliedWorkoutId: row.applied_workout_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    validity,
  };
}

export async function getAcceptedTargetsForSummary(
  db: D1Database,
  sourceWorkoutId: string,
): Promise<Map<string, AcceptedNextTargetSummary>> {
  const result = await db
    .prepare(
      `SELECT ant.*, w.version AS current_source_version,
              w.deleted_at AS source_deleted_at
       FROM accepted_next_target ant
       JOIN workout w ON w.id = ant.source_workout_id
       WHERE ant.owner_id = ? AND ant.source_workout_id = ?
       ORDER BY ant.created_at DESC, ant.id DESC`,
    )
    .bind(ownerId, sourceWorkoutId)
    .all<AcceptedTargetRow>();
  const targets = new Map<string, AcceptedNextTargetSummary>();
  for (const row of result.results) {
    if (!targets.has(row.exercise_id))
      targets.set(row.exercise_id, acceptedTargetRowToSummary(row));
  }
  return targets;
}

export async function getApplicableAcceptedTargetsForCopy(
  db: D1Database,
  sourceWorkoutId: string,
): Promise<ApplicableAcceptedTarget[]> {
  const result = await db
    .prepare(
      `SELECT ant.id, ant.exercise_id, ant.source_workout_id,
              ant.source_workout_version, ant.target_load_grams,
              ant.target_rep_min, ant.target_rep_max, ant.target_working_sets
       FROM accepted_next_target ant
       JOIN workout source ON source.id = ant.source_workout_id
       WHERE ant.owner_id = ? AND ant.source_workout_id = ?
         AND ant.status = 'accepted'
         AND source.owner_id = ? AND source.status = 'completed'
         AND source.deleted_at IS NULL
         AND source.version = ant.source_workout_version`,
    )
    .bind(ownerId, sourceWorkoutId, ownerId)
    .all<AcceptedTargetRow>();
  return result.results.map((row) => ({
    id: row.id,
    exerciseId: row.exercise_id,
    sourceWorkoutId: row.source_workout_id,
    sourceWorkoutVersion: Number(row.source_workout_version),
    targetLoadGrams: Number(row.target_load_grams),
    targetRepMin: Number(row.target_rep_min),
    targetRepMax: Number(row.target_rep_max),
    targetWorkingSets: Number(row.target_working_sets),
  }));
}

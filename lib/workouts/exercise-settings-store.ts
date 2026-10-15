import { listExerciseMasters } from './server-store';
import {
  normalizeExerciseName,
  validateExerciseMasterUpdate,
  WorkoutConflictError,
  WorkoutNotFoundError,
} from './validation';

export async function updateExerciseMaster(
  db: D1Database,
  exerciseId: string,
  input: unknown,
) {
  const value = validateExerciseMasterUpdate(input);
  try {
    const result = await db
      .prepare(`
      UPDATE exercise_master
      SET name = ?, normalized_name = ?, body_part = ?, default_rep_min = ?, default_rep_max = ?,
          default_working_sets = ?, default_increment_grams = ?, default_rest_seconds = ?, rep_mode = COALESCE(?, rep_mode), load_basis = COALESCE(?, load_basis), updated_at = ?
      WHERE id = ? AND owner_id = ? AND archived_at IS NULL
    `)
      .bind(
        value.name,
        normalizeExerciseName(value.name),
        value.bodyPart,
        value.defaultRepMin,
        value.defaultRepMax,
        value.defaultWorkingSets,
        value.defaultIncrementGrams,
        value.defaultRestSeconds,
        value.repMode ?? null,
        value.loadBasis ?? null,
        new Date().toISOString(),
        exerciseId,
        'default',
      )
      .run();
    if (!result.meta.changes)
      throw new WorkoutNotFoundError('種目が見つかりません');
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('unique')
    )
      throw new WorkoutConflictError('同じ名前の種目がすでにあります');
    throw error;
  }
  const updated = (await listExerciseMasters(db)).find(
    (item) => item.id === exerciseId,
  );
  if (!updated) throw new WorkoutNotFoundError('種目が見つかりません');
  // Preserve exercise IDs and past workout snapshots; edits affect new entries.
  return updated;
}

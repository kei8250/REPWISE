import type {
  AcceptNextTargetInput,
  AcceptNextTargetResult,
} from './accepted-next-target';
import { getWorkoutCompletionProgressionSummary } from './server-store';
import { acceptedTargetRowToSummary } from './accepted-next-target-queries';
import {
  WorkoutConflictError,
  WorkoutNotFoundError,
  WorkoutValidationError,
  WorkoutVersionConflictError,
} from '@/lib/workouts/validation';

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

type SourceWorkoutRow = {
  id: string;
  version: number;
  status: string;
  deleted_at: string | null;
  updated_at: string;
};

function validateInput(value: unknown): AcceptNextTargetInput {
  const input =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const issues: Array<{ path: string; message: string }> = [];
  const stringValue = (key: string) => {
    const result = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!result || !/^[A-Za-z0-9_-]+$/.test(result))
      issues.push({ path: key, message: 'IDの形式が正しくありません' });
    return result;
  };
  const sourceWorkoutVersion = input.sourceWorkoutVersion;
  if (
    typeof sourceWorkoutVersion !== 'number' ||
    !Number.isInteger(sourceWorkoutVersion) ||
    sourceWorkoutVersion < 1
  ) {
    issues.push({
      path: 'sourceWorkoutVersion',
      message: 'source versionが正しくありません',
    });
  }
  const result = {
    mutationId: stringValue('mutationId'),
    exerciseId: stringValue('exerciseId'),
    sourceWorkoutId: stringValue('sourceWorkoutId'),
    sourceWorkoutVersion:
      typeof sourceWorkoutVersion === 'number' ? sourceWorkoutVersion : 0,
  };
  if (issues.length) throw new WorkoutValidationError(issues);
  return result;
}

async function findByMutationId(db: D1Database, mutationId: string) {
  return db
    .prepare(
      `SELECT ant.*, w.version AS current_source_version,
              w.deleted_at AS source_deleted_at
       FROM accepted_next_target ant
       JOIN workout w ON w.id = ant.source_workout_id
       WHERE ant.owner_id = ? AND ant.mutation_id = ?`,
    )
    .bind(ownerId, mutationId)
    .first<AcceptedTargetRow>();
}

function assertIdempotentMatch(
  row: AcceptedTargetRow,
  input: AcceptNextTargetInput,
) {
  if (
    row.exercise_id !== input.exerciseId ||
    row.source_workout_id !== input.sourceWorkoutId ||
    Number(row.source_workout_version) !== input.sourceWorkoutVersion
  ) {
    throw new WorkoutConflictError(
      '同じmutation_idが異なる次回目標に使用されています',
    );
  }
}

export async function acceptNextTarget(
  db: D1Database,
  value: unknown,
): Promise<AcceptNextTargetResult> {
  const input = validateInput(value);
  const processed = await findByMutationId(db, input.mutationId);
  if (processed) {
    assertIdempotentMatch(processed, input);
    return { duplicate: true, target: acceptedTargetRowToSummary(processed) };
  }

  const source = await db
    .prepare(
      `SELECT id, version, status, deleted_at, updated_at
       FROM workout WHERE id = ? AND owner_id = ?`,
    )
    .bind(input.sourceWorkoutId, ownerId)
    .first<SourceWorkoutRow>();
  if (!source || source.status !== 'completed')
    throw new WorkoutNotFoundError('完了済みワークアウトが見つかりません');
  if (source.deleted_at)
    throw new WorkoutConflictError(
      '削除済みの記録から次回目標は設定できません',
    );
  if (Number(source.version) !== input.sourceWorkoutVersion) {
    throw new WorkoutVersionConflictError({
      type: 'stale',
      baseVersion: input.sourceWorkoutVersion,
      serverVersion: Number(source.version),
      serverUpdatedAt: source.updated_at,
    });
  }

  const summary = await getWorkoutCompletionProgressionSummary(
    db,
    input.sourceWorkoutId,
  );
  const exercise = summary.exercises.find(
    (candidate) => candidate.exerciseId === input.exerciseId,
  );
  const suggestion = exercise?.decision.nextTarget;
  if (!exercise || !suggestion)
    throw new WorkoutConflictError('採用できる次回候補がありません');

  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        `UPDATE accepted_next_target
         SET status = 'superseded', updated_at = ?
         WHERE owner_id = ? AND exercise_id = ? AND status = 'accepted'`,
      )
      .bind(timestamp, ownerId, input.exerciseId),
    db
      .prepare(
        `INSERT INTO accepted_next_target
          (id, owner_id, mutation_id, exercise_id, source_workout_id,
           source_workout_version, target_load_grams, target_rep_min,
           target_rep_max, target_working_sets, status, applied_workout_id,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', NULL, ?, ?)`,
      )
      .bind(
        id,
        ownerId,
        input.mutationId,
        input.exerciseId,
        input.sourceWorkoutId,
        input.sourceWorkoutVersion,
        suggestion.loadGrams,
        suggestion.repMin,
        suggestion.repMax,
        suggestion.workingSets,
        timestamp,
        timestamp,
      ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await findByMutationId(db, input.mutationId);
    if (raced) {
      assertIdempotentMatch(raced, input);
      return {
        duplicate: true,
        target: acceptedTargetRowToSummary(raced),
      };
    }
    throw error;
  }
  const saved = await findByMutationId(db, input.mutationId);
  if (!saved) throw new Error('保存した次回目標を読み込めませんでした');
  return {
    duplicate: false,
    target: acceptedTargetRowToSummary(saved),
  };
}

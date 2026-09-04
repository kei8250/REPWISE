import type {
  CreateWorkoutInput,
  ExerciseMaster,
  Workout,
  WorkoutExercise,
  WorkoutMutationInput,
  WorkoutMutationResult,
  WorkoutSet,
  WorkoutSummary,
} from './types';
import { buildSnapshotReplacementPlan } from './snapshot';
import {
  normalizeExerciseName,
  validateExerciseMasterInput,
  validateWorkoutExercise,
  validateWorkoutSet,
  WorkoutConflictError,
  WorkoutNotFoundError,
  WorkoutVersionAheadError,
  WorkoutVersionConflictError,
} from './validation';

const ownerId = 'default';

type WorkoutRow = {
  id: string;
  name: string;
  status: Workout['status'];
  local_date: string;
  timezone: string;
  started_at: string;
  ended_at: string | null;
  overall_note: string;
  rating: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  source_workout_id: string | null;
};

type ExerciseRow = {
  id: string;
  exercise_id: string;
  position: number;
  status: WorkoutExercise['status'];
  exercise_name_snapshot: string;
  note: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SetRow = {
  id: string;
  workout_exercise_id: string;
  position: number;
  status: WorkoutSet['status'];
  set_type: 'working';
  target_load_grams: number | null;
  target_rep_min: number | null;
  target_rep_max: number | null;
  actual_load_grams: number | null;
  actual_reps: number | null;
  memo: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProcessedMutationRow = {
  entity_type: string;
  entity_id: string;
  operation: string;
  base_version: number;
  request_fingerprint: string;
  result_json: string;
};

function now() {
  return new Date().toISOString();
}

export async function listExerciseMasters(
  db: D1Database,
): Promise<ExerciseMaster[]> {
  const result = await db
    .prepare(`
    SELECT id, name, normalized_name, body_part, measurement_type, default_rep_min,
           default_rep_max, default_working_sets, default_increment_grams, default_rest_seconds
    FROM exercise_master
    WHERE owner_id = ? AND archived_at IS NULL
    ORDER BY body_part, name
  `)
    .bind(ownerId)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    bodyPart: String(row.body_part),
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
  }));
}

export async function createExerciseMaster(
  db: D1Database,
  value: unknown,
): Promise<ExerciseMaster> {
  const input = validateExerciseMasterInput(value);
  const createdAt = now();
  const id = input.id ?? crypto.randomUUID();
  const normalizedName = normalizeExerciseName(input.name);
  try {
    await db
      .prepare(`
      INSERT INTO exercise_master
        (id, owner_id, name, normalized_name, body_part, measurement_type, default_rep_min, default_rep_max,
         default_working_sets, default_increment_grams, default_rest_seconds, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'weight_reps', 8, 12, 3, 2500, 90, ?, ?)
    `)
      .bind(
        id,
        ownerId,
        input.name,
        normalizedName,
        input.bodyPart,
        createdAt,
        createdAt,
      )
      .run();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('unique')
    )
      throw new WorkoutConflictError('同じ名前の種目がすでにあります');
    throw error;
  }
  return {
    id,
    name: input.name,
    normalizedName,
    bodyPart: input.bodyPart,
    measurementType: 'weight_reps',
    defaultRepMin: 8,
    defaultRepMax: 12,
    defaultWorkingSets: 3,
    defaultIncrementGrams: 2500,
    defaultRestSeconds: 90,
  };
}

export async function createWorkout(
  db: D1Database,
  input: CreateWorkoutInput,
): Promise<Workout> {
  const id = input.id ?? crypto.randomUUID();
  const createdAt = now();
  const startedAt = input.startedAt ?? createdAt;
  await db
    .prepare(`
    INSERT INTO workout
      (id, owner_id, name, status, local_date, timezone, started_at, overall_note, version, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, '', 1, ?, ?)
  `)
    .bind(
      id,
      ownerId,
      input.name,
      input.localDate,
      input.timezone,
      startedAt,
      createdAt,
      createdAt,
    )
    .run();
  const workout = await getWorkout(db, id);
  if (!workout) throw new Error('作成したワークアウトを読み込めませんでした');
  return workout;
}

export async function listWorkouts(
  db: D1Database,
  status?: string,
  limit = 30,
): Promise<WorkoutSummary[]> {
  const statusClause = status ? 'AND w.status = ?' : '';
  const statement = db.prepare(`
    SELECT w.id, w.name, w.status, w.local_date, w.started_at, w.ended_at,
           COUNT(DISTINCT we.id) AS exercise_count,
           COUNT(ws.id) AS set_count,
           SUM(CASE WHEN ws.status = 'completed' THEN 1 ELSE 0 END) AS completed_set_count,
           COALESCE(SUM(CASE WHEN ws.status = 'completed' THEN ws.actual_load_grams * ws.actual_reps ELSE 0 END), 0) AS total_volume_grams
    FROM workout w
    LEFT JOIN workout_exercise we ON we.workout_id = w.id
    LEFT JOIN workout_set ws ON ws.workout_exercise_id = we.id AND ws.deleted_at IS NULL
    WHERE w.owner_id = ? AND w.deleted_at IS NULL ${statusClause}
    GROUP BY w.id
    ORDER BY w.local_date DESC, w.started_at DESC
    LIMIT ?
  `);
  const result = status
    ? await statement
        .bind(ownerId, status, limit)
        .all<Record<string, unknown>>()
    : await statement.bind(ownerId, limit).all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    status: String(row.status) as Workout['status'],
    localDate: String(row.local_date),
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null ? null : String(row.ended_at as string),
    exerciseCount: Number(row.exercise_count),
    setCount: Number(row.set_count),
    completedSetCount: Number(row.completed_set_count),
    totalVolumeGrams: Number(row.total_volume_grams),
  }));
}

export async function getWorkout(
  db: D1Database,
  id: string,
  includeDeleted = false,
): Promise<Workout | null> {
  const row = await db
    .prepare(`
    SELECT id, name, status, local_date, timezone, started_at, ended_at, overall_note, rating, version, created_at, updated_at, deleted_at, source_workout_id
    FROM workout WHERE id = ? AND owner_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
  `)
    .bind(id, ownerId)
    .first<WorkoutRow>();
  if (!row) return null;
  const exerciseResult = await db
    .prepare(`
    SELECT id, exercise_id, position, status, exercise_name_snapshot, note, started_at, completed_at, created_at, updated_at
    FROM workout_exercise WHERE workout_id = ? ORDER BY position, created_at
  `)
    .bind(id)
    .all<ExerciseRow>();
  const setResult = await db
    .prepare(`
    SELECT ws.id, ws.workout_exercise_id, ws.position, ws.status, ws.set_type, ws.target_load_grams,
           ws.target_rep_min, ws.target_rep_max, ws.actual_load_grams, ws.actual_reps, ws.memo,
           ws.completed_at, ws.created_at, ws.updated_at
    FROM workout_set ws
    JOIN workout_exercise we ON we.id = ws.workout_exercise_id
    WHERE we.workout_id = ? AND ws.deleted_at IS NULL
    ORDER BY we.position, ws.position, ws.created_at
  `)
    .bind(id)
    .all<SetRow>();
  const setsByExercise = new Map<string, WorkoutSet[]>();
  for (const set of setResult.results) {
    const list = setsByExercise.get(set.workout_exercise_id) ?? [];
    list.push({
      id: set.id,
      position: Number(set.position),
      status: set.status,
      setType: 'working',
      targetLoadGrams:
        set.target_load_grams === null ? null : Number(set.target_load_grams),
      targetRepMin:
        set.target_rep_min === null ? null : Number(set.target_rep_min),
      targetRepMax:
        set.target_rep_max === null ? null : Number(set.target_rep_max),
      actualLoadGrams:
        set.actual_load_grams === null ? null : Number(set.actual_load_grams),
      actualReps: set.actual_reps === null ? null : Number(set.actual_reps),
      memo: set.memo,
      completedAt: set.completed_at,
      createdAt: set.created_at,
      updatedAt: set.updated_at,
    });
    setsByExercise.set(set.workout_exercise_id, list);
  }
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    localDate: row.local_date,
    timezone: row.timezone,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    overallNote: row.overall_note,
    rating: row.rating === null ? null : Number(row.rating),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    sourceWorkoutId: row.source_workout_id,
    exercises: exerciseResult.results.map((exercise) => ({
      id: exercise.id,
      exerciseId: exercise.exercise_id,
      position: Number(exercise.position),
      status: exercise.status,
      exerciseNameSnapshot: exercise.exercise_name_snapshot,
      note: exercise.note,
      startedAt: exercise.started_at,
      completedAt: exercise.completed_at,
      createdAt: exercise.created_at,
      updatedAt: exercise.updated_at,
      sets: setsByExercise.get(exercise.id) ?? [],
    })),
  };
}

async function assertExerciseMastersExist(
  db: D1Database,
  exercises: WorkoutExercise[],
) {
  if (!exercises.length) return;
  const results = await db.batch(
    exercises.map((exercise) =>
      db
        .prepare(
          'SELECT id FROM exercise_master WHERE id = ? AND owner_id = ? AND archived_at IS NULL',
        )
        .bind(exercise.exerciseId, ownerId),
    ),
  );
  if (results.some((result) => !result.results.length))
    throw new WorkoutNotFoundError('選択された種目が見つかりません');
}

async function assertCopySourceAvailable(db: D1Database, workout: Workout) {
  if (!workout.sourceWorkoutId) return;
  const source = await db
    .prepare(
      `SELECT id FROM workout
       WHERE id = ? AND owner_id = ? AND status = 'completed' AND deleted_at IS NULL`,
    )
    .bind(workout.sourceWorkoutId, ownerId)
    .first<{ id: string }>();
  if (!source) {
    throw new WorkoutNotFoundError(
      'コピー元の完了済みワークアウトが見つかりません',
    );
  }
}

function assertWorkoutCanComplete(workout: Workout) {
  if (!workout.exercises.length)
    throw new WorkoutConflictError('種目を1つ以上追加してください');
  const completedSets = workout.exercises
    .flatMap((exercise) => exercise.sets)
    .filter((set) => set.status === 'completed');
  if (!completedSets.length)
    throw new WorkoutConflictError('完了したセットを1つ以上記録してください');
}

function makeServerSnapshot(
  incoming: Workout,
  existing: Workout | null,
  operation: WorkoutMutationInput['operation'],
  updatedAt: string,
): Workout {
  const completed = operation === 'complete' || operation === 'edit';
  const tombstoneOperation = operation === 'delete' || operation === 'restore';
  const source = tombstoneOperation && existing ? existing : incoming;
  return {
    ...source,
    status: completed || tombstoneOperation ? 'completed' : 'active',
    startedAt: existing?.startedAt ?? incoming.startedAt,
    endedAt:
      completed || tombstoneOperation
        ? (source.endedAt ?? existing?.endedAt ?? updatedAt)
        : null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? incoming.createdAt,
    updatedAt,
    sourceWorkoutId: existing
      ? existing.sourceWorkoutId
      : incoming.sourceWorkoutId,
    deletedAt:
      operation === 'delete'
        ? updatedAt
        : operation === 'restore'
          ? null
          : (existing?.deletedAt ?? incoming.deletedAt ?? null),
    exercises: [...source.exercises]
      .sort((a, b) => a.position - b.position)
      .map((exercise) => ({
        ...exercise,
        updatedAt,
        sets: [...exercise.sets]
          .sort((a, b) => a.position - b.position)
          .map((set) => ({ ...set, updatedAt })),
      })),
  };
}

function snapshotStatements(
  db: D1Database,
  workout: Workout,
  creating: boolean,
  mutation: WorkoutMutationInput,
) {
  const statements: D1PreparedStatement[] = creating
    ? [
        db
          .prepare(
            `INSERT INTO workout
              (id, owner_id, name, status, local_date, timezone, started_at, ended_at, overall_note, rating, version, created_at, updated_at, deleted_at, source_workout_id)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM processed_mutation WHERE mutation_id = ? AND owner_id = ?
             )`,
          )
          .bind(
            workout.id,
            ownerId,
            workout.name,
            workout.status,
            workout.localDate,
            workout.timezone,
            workout.startedAt,
            workout.endedAt,
            workout.overallNote,
            workout.rating,
            workout.version,
            workout.createdAt,
            workout.updatedAt,
            workout.deletedAt,
            workout.sourceWorkoutId,
            mutation.mutationId,
            ownerId,
          ),
      ]
    : [
        db
          .prepare(
            `UPDATE workout
             SET name = ?, status = ?, local_date = ?, timezone = ?, ended_at = ?, overall_note = ?, rating = ?, version = ?, updated_at = ?, deleted_at = ?, source_workout_id = ?
             WHERE id = ? AND owner_id = ? AND version = ?
               AND EXISTS (
                 SELECT 1 FROM processed_mutation WHERE mutation_id = ? AND owner_id = ?
               )`,
          )
          .bind(
            workout.name,
            workout.status,
            workout.localDate,
            workout.timezone,
            workout.endedAt,
            workout.overallNote,
            workout.rating,
            workout.version,
            workout.updatedAt,
            workout.deletedAt,
            workout.sourceWorkoutId,
            workout.id,
            ownerId,
            mutation.baseVersion,
            mutation.mutationId,
            ownerId,
          ),
      ];
  if (mutation.operation === 'delete' || mutation.operation === 'restore') {
    return statements;
  }
  if (!creating) {
    statements.push(
      db
        .prepare(
          `DELETE FROM workout_exercise
           WHERE workout_id = ?
             AND EXISTS (
               SELECT 1 FROM processed_mutation WHERE mutation_id = ? AND owner_id = ?
             )`,
        )
        .bind(workout.id, mutation.mutationId, ownerId),
    );
  }
  for (const exercise of workout.exercises) {
    statements.push(
      db
        .prepare(
          `INSERT INTO workout_exercise
            (id, workout_id, exercise_id, position, status, exercise_name_snapshot, note, started_at, completed_at, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM processed_mutation WHERE mutation_id = ? AND owner_id = ?
           )`,
        )
        .bind(
          exercise.id,
          workout.id,
          exercise.exerciseId,
          exercise.position,
          exercise.status,
          exercise.exerciseNameSnapshot,
          exercise.note,
          exercise.startedAt,
          exercise.completedAt,
          exercise.createdAt,
          exercise.updatedAt,
          mutation.mutationId,
          ownerId,
        ),
    );
    for (const set of exercise.sets) {
      statements.push(
        db
          .prepare(
            `INSERT INTO workout_set
              (id, workout_exercise_id, position, status, set_type, target_load_grams, target_rep_min, target_rep_max,
               actual_load_grams, actual_reps, memo, completed_at, created_at, updated_at)
             SELECT ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM processed_mutation WHERE mutation_id = ? AND owner_id = ?
             )`,
          )
          .bind(
            set.id,
            exercise.id,
            set.position,
            set.status,
            set.targetLoadGrams,
            set.targetRepMin,
            set.targetRepMax,
            set.actualLoadGrams,
            set.actualReps,
            set.memo,
            set.completedAt,
            set.createdAt,
            set.updatedAt,
            mutation.mutationId,
            ownerId,
          ),
      );
    }
  }
  return statements;
}

async function mutationFingerprint(
  mutation: WorkoutMutationInput,
  includeBaseVersion = true,
) {
  const workout = { ...mutation.payload.workout };
  // Keep the Phase 1B-1 fingerprint stable for existing non-deleted payloads.
  // deletedAt is only material to a delete mutation when it has a timestamp.
  if (workout.deletedAt === null)
    delete (workout as { deletedAt?: string | null }).deletedAt;
  // Phase 1B-2b adds lineage. Omitting a null value keeps fingerprints from
  // older queued and already-processed mutations stable.
  if (workout.sourceWorkoutId === null)
    delete (workout as { sourceWorkoutId?: string | null }).sourceWorkoutId;
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      operation: mutation.operation,
      ...(includeBaseVersion ? { baseVersion: mutation.baseVersion } : {}),
      payload: { workout },
    }),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function assertMutationCanApply(
  mutation: WorkoutMutationInput,
  existing: Workout | null,
) {
  const creating = mutation.operation === 'create';
  if (creating) {
    if (mutation.baseVersion !== 0) {
      throw new WorkoutVersionAheadError({
        type: 'ahead',
        baseVersion: mutation.baseVersion,
        serverVersion: existing?.version ?? 0,
        serverUpdatedAt: existing?.updatedAt ?? mutation.createdAt,
      });
    }
    if (existing) {
      throw new WorkoutConflictError('同じIDのワークアウトがすでにあります');
    }
    return;
  }
  if (!existing) {
    throw new WorkoutNotFoundError(
      '先にワークアウト作成を同期する必要があります',
    );
  }
  const conflict = {
    baseVersion: mutation.baseVersion,
    serverVersion: existing.version,
    serverUpdatedAt: existing.updatedAt,
  } as const;
  if (mutation.baseVersion < existing.version) {
    throw new WorkoutVersionConflictError({ type: 'stale', ...conflict });
  }
  if (mutation.baseVersion > existing.version) {
    throw new WorkoutVersionAheadError({ type: 'ahead', ...conflict });
  }
  const needsActive =
    mutation.operation === 'replace' || mutation.operation === 'complete';
  const needsCompleted =
    mutation.operation === 'edit' || mutation.operation === 'delete';
  if (needsActive && (existing.status !== 'active' || existing.deletedAt))
    throw new WorkoutConflictError('進行中ワークアウトに適用できません');
  if (needsCompleted && (existing.status !== 'completed' || existing.deletedAt))
    throw new WorkoutConflictError('完了済みワークアウトに適用できません');
  if (
    mutation.operation === 'restore' &&
    (existing.status !== 'completed' || !existing.deletedAt)
  )
    throw new WorkoutConflictError('削除済みワークアウトに適用できません');
}

function mutationMatchesProcessed(
  processed: ProcessedMutationRow,
  mutation: WorkoutMutationInput,
  fingerprint: string,
  legacyFingerprint: string,
) {
  return (
    processed.entity_type === mutation.entityType &&
    processed.entity_id === mutation.entityId &&
    processed.operation === mutation.operation &&
    (processed.request_fingerprint === fingerprint ||
      (processed.base_version === 0 &&
        processed.request_fingerprint === legacyFingerprint))
  );
}

async function findProcessedMutation(db: D1Database, mutationId: string) {
  return db
    .prepare(
      `SELECT entity_type, entity_id, operation, base_version, request_fingerprint, result_json
       FROM processed_mutation WHERE mutation_id = ? AND owner_id = ?`,
    )
    .bind(mutationId, ownerId)
    .first<ProcessedMutationRow>();
}

function processedMutationGate(
  db: D1Database,
  mutation: WorkoutMutationInput,
  fingerprint: string,
  result: WorkoutMutationResult,
  processedAt: string,
) {
  const commonValues = [
    mutation.mutationId,
    ownerId,
    mutation.entityType,
    mutation.entityId,
    mutation.operation,
    mutation.baseVersion,
    fingerprint,
    JSON.stringify(result),
    processedAt,
  ] as const;
  if (mutation.operation === 'create') {
    const sourceWorkoutId = mutation.payload.workout.sourceWorkoutId;
    const sourcePredicate = sourceWorkoutId
      ? `AND EXISTS (
           SELECT 1 FROM workout
           WHERE id = ? AND owner_id = ? AND status = 'completed' AND deleted_at IS NULL
         )`
      : '';
    return db
      .prepare(
        `INSERT INTO processed_mutation
          (mutation_id, owner_id, entity_type, entity_id, operation, base_version, request_fingerprint, result_json, processed_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM workout WHERE id = ? AND owner_id = ?
         ) ${sourcePredicate}`,
      )
      .bind(
        ...commonValues,
        mutation.entityId,
        ownerId,
        ...(sourceWorkoutId ? [sourceWorkoutId, ownerId] : []),
      );
  }
  const operationPredicate =
    mutation.operation === 'restore'
      ? "status = 'completed' AND deleted_at IS NOT NULL"
      : mutation.operation === 'edit' || mutation.operation === 'delete'
        ? "status = 'completed' AND deleted_at IS NULL"
        : "status = 'active' AND deleted_at IS NULL";
  return db
    .prepare(
      `INSERT INTO processed_mutation
        (mutation_id, owner_id, entity_type, entity_id, operation, base_version, request_fingerprint, result_json, processed_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM workout
         WHERE id = ? AND owner_id = ? AND version = ?
           AND ${operationPredicate}
       )`,
    )
    .bind(...commonValues, mutation.entityId, ownerId, mutation.baseVersion);
}

export async function applyWorkoutMutation(
  db: D1Database,
  mutation: WorkoutMutationInput,
): Promise<WorkoutMutationResult> {
  const fingerprint = await mutationFingerprint(mutation);
  const legacyFingerprint = await mutationFingerprint(mutation, false);
  const processed = await findProcessedMutation(db, mutation.mutationId);
  if (processed) {
    if (
      !mutationMatchesProcessed(
        processed,
        mutation,
        fingerprint,
        legacyFingerprint,
      )
    ) {
      throw new WorkoutConflictError(
        '同じmutation_idが異なる変更に使用されています',
      );
    }
    const previous = JSON.parse(processed.result_json) as WorkoutMutationResult;
    previous.workout.deletedAt ??= null;
    previous.workout.sourceWorkoutId ??= null;
    return { ...previous, duplicate: true };
  }

  const existing = await getWorkout(db, mutation.entityId, true);
  const creating = mutation.operation === 'create';
  assertMutationCanApply(mutation, existing);

  const saved = makeServerSnapshot(
    mutation.payload.workout,
    existing,
    mutation.operation,
    now(),
  );
  if (mutation.operation === 'complete') assertWorkoutCanComplete(saved);
  if (creating) await assertCopySourceAvailable(db, saved);
  if (mutation.operation !== 'delete' && mutation.operation !== 'restore')
    await assertExerciseMastersExist(db, saved.exercises);
  const result: WorkoutMutationResult = {
    mutationId: mutation.mutationId,
    duplicate: false,
    workout: saved,
  };
  const statements = [
    processedMutationGate(db, mutation, fingerprint, result, saved.updatedAt),
    ...snapshotStatements(db, saved, creating, mutation),
  ];
  let batchResults: D1Result<unknown>[];
  try {
    batchResults = await db.batch(statements);
  } catch (error) {
    const raced = await findProcessedMutation(db, mutation.mutationId);
    if (
      raced &&
      mutationMatchesProcessed(raced, mutation, fingerprint, legacyFingerprint)
    ) {
      const previous = JSON.parse(raced.result_json) as WorkoutMutationResult;
      previous.workout.deletedAt ??= null;
      previous.workout.sourceWorkoutId ??= null;
      return { ...previous, duplicate: true };
    }
    throw error;
  }
  if (Number(batchResults[0]?.meta.changes ?? 0) === 0) {
    const latest = await getWorkout(db, mutation.entityId, true);
    assertMutationCanApply(mutation, latest);
    if (creating) await assertCopySourceAvailable(db, saved);
    throw new WorkoutConflictError(
      '同期中にサーバー状態が変更されたため保存を停止しました',
    );
  }
  return result;
}

export async function replaceWorkout(
  db: D1Database,
  workout: Workout,
): Promise<Workout> {
  const existing = await getWorkout(db, workout.id);
  if (!existing) throw new WorkoutNotFoundError('ワークアウトが見つかりません');
  if (existing.status === 'completed')
    throw new WorkoutConflictError(
      '完了済みワークアウトはPhase 1Aでは編集できません',
    );
  const replacement = buildSnapshotReplacementPlan(existing, workout);
  workout = replacement.workout;
  await assertExerciseMastersExist(db, workout.exercises);
  const updatedAt = now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE workout SET name = ?, local_date = ?, timezone = ?, overall_note = ?, rating = ?, updated_at = ?, version = version + 1 WHERE id = ? AND owner_id = ?`,
      )
      .bind(
        workout.name,
        workout.localDate,
        workout.timezone,
        workout.overallNote,
        workout.rating,
        updatedAt,
        workout.id,
        ownerId,
      ),
    db
      .prepare('DELETE FROM workout_exercise WHERE workout_id = ?')
      .bind(workout.id),
  ];
  for (const exercise of workout.exercises) {
    statements.push(
      db
        .prepare(`
      INSERT INTO workout_exercise
        (id, workout_id, exercise_id, position, status, exercise_name_snapshot, note, started_at, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
        .bind(
          exercise.id,
          workout.id,
          exercise.exerciseId,
          exercise.position,
          exercise.status,
          exercise.exerciseNameSnapshot,
          exercise.note,
          exercise.startedAt,
          exercise.completedAt,
          exercise.createdAt,
          updatedAt,
        ),
    );
    for (const set of exercise.sets) {
      statements.push(
        db
          .prepare(`
        INSERT INTO workout_set
          (id, workout_exercise_id, position, status, set_type, target_load_grams, target_rep_min, target_rep_max,
           actual_load_grams, actual_reps, memo, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
          .bind(
            set.id,
            exercise.id,
            set.position,
            set.status,
            set.targetLoadGrams,
            set.targetRepMin,
            set.targetRepMax,
            set.actualLoadGrams,
            set.actualReps,
            set.memo,
            set.completedAt,
            set.createdAt,
            updatedAt,
          ),
      );
    }
  }
  await db.batch(statements);
  const saved = await getWorkout(db, workout.id);
  if (!saved) throw new Error('保存したワークアウトを読み込めませんでした');
  return saved;
}

export async function completeWorkout(
  db: D1Database,
  id: string,
): Promise<Workout> {
  const workout = await getWorkout(db, id);
  if (!workout) throw new WorkoutNotFoundError('ワークアウトが見つかりません');
  assertWorkoutCanComplete(workout);
  const endedAt = now();
  await db
    .prepare(
      `UPDATE workout SET status = 'completed', ended_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND owner_id = ?`,
    )
    .bind(endedAt, endedAt, id, ownerId)
    .run();
  const completed = await getWorkout(db, id);
  if (!completed) throw new Error('完了したワークアウトを読み込めませんでした');
  return completed;
}

export async function addWorkoutExercise(
  db: D1Database,
  workoutId: string,
  value: unknown,
) {
  if (!(await getWorkout(db, workoutId)))
    throw new WorkoutNotFoundError('ワークアウトが見つかりません');
  const exercise = validateWorkoutExercise(value);
  await assertExerciseMastersExist(db, [exercise]);
  await db
    .prepare(
      `INSERT INTO workout_exercise (id, workout_id, exercise_id, position, status, exercise_name_snapshot, note, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      exercise.id,
      workoutId,
      exercise.exerciseId,
      exercise.position,
      exercise.status,
      exercise.exerciseNameSnapshot,
      exercise.note,
      exercise.startedAt,
      exercise.completedAt,
      exercise.createdAt,
      exercise.updatedAt,
    )
    .run();
  return getWorkout(db, workoutId);
}

export async function updateWorkoutExercise(
  db: D1Database,
  workoutId: string,
  exerciseId: string,
  value: unknown,
) {
  const exercise = validateWorkoutExercise(value);
  if (exercise.id !== exerciseId)
    throw new WorkoutConflictError('種目IDが一致しません');
  const result = await db
    .prepare(
      `UPDATE workout_exercise SET position = ?, status = ?, note = ?, started_at = ?, completed_at = ?, updated_at = ? WHERE id = ? AND workout_id = ?`,
    )
    .bind(
      exercise.position,
      exercise.status,
      exercise.note,
      exercise.startedAt,
      exercise.completedAt,
      now(),
      exerciseId,
      workoutId,
    )
    .run();
  if (!result.meta.changes)
    throw new WorkoutNotFoundError('ワークアウト種目が見つかりません');
  return getWorkout(db, workoutId);
}

export async function deleteWorkoutExercise(
  db: D1Database,
  workoutId: string,
  exerciseId: string,
) {
  const result = await db
    .prepare('DELETE FROM workout_exercise WHERE id = ? AND workout_id = ?')
    .bind(exerciseId, workoutId)
    .run();
  if (!result.meta.changes)
    throw new WorkoutNotFoundError('ワークアウト種目が見つかりません');
  return getWorkout(db, workoutId);
}

export async function addWorkoutSet(
  db: D1Database,
  workoutId: string,
  workoutExerciseId: string,
  value: unknown,
) {
  const set = validateWorkoutSet(value);
  const owner = await db
    .prepare('SELECT id FROM workout_exercise WHERE id = ? AND workout_id = ?')
    .bind(workoutExerciseId, workoutId)
    .first();
  if (!owner)
    throw new WorkoutNotFoundError('ワークアウト種目が見つかりません');
  await db
    .prepare(
      `INSERT INTO workout_set (id, workout_exercise_id, position, status, set_type, target_load_grams, target_rep_min, target_rep_max, actual_load_grams, actual_reps, memo, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      set.id,
      workoutExerciseId,
      set.position,
      set.status,
      set.targetLoadGrams,
      set.targetRepMin,
      set.targetRepMax,
      set.actualLoadGrams,
      set.actualReps,
      set.memo,
      set.completedAt,
      set.createdAt,
      set.updatedAt,
    )
    .run();
  return getWorkout(db, workoutId);
}

export async function updateWorkoutSet(
  db: D1Database,
  workoutId: string,
  workoutExerciseId: string,
  setId: string,
  value: unknown,
) {
  const set = validateWorkoutSet(value);
  if (set.id !== setId)
    throw new WorkoutConflictError('セットIDが一致しません');
  const result = await db
    .prepare(
      `UPDATE workout_set SET position = ?, status = ?, target_load_grams = ?, target_rep_min = ?, target_rep_max = ?, actual_load_grams = ?, actual_reps = ?, memo = ?, completed_at = ?, updated_at = ? WHERE id = ? AND workout_exercise_id = ? AND EXISTS (SELECT 1 FROM workout_exercise WHERE id = ? AND workout_id = ?)`,
    )
    .bind(
      set.position,
      set.status,
      set.targetLoadGrams,
      set.targetRepMin,
      set.targetRepMax,
      set.actualLoadGrams,
      set.actualReps,
      set.memo,
      set.completedAt,
      now(),
      setId,
      workoutExerciseId,
      workoutExerciseId,
      workoutId,
    )
    .run();
  if (!result.meta.changes)
    throw new WorkoutNotFoundError('セットが見つかりません');
  return getWorkout(db, workoutId);
}

export async function deleteWorkoutSet(
  db: D1Database,
  workoutId: string,
  workoutExerciseId: string,
  setId: string,
) {
  const result = await db
    .prepare(
      `DELETE FROM workout_set WHERE id = ? AND workout_exercise_id = ? AND EXISTS (SELECT 1 FROM workout_exercise WHERE id = ? AND workout_id = ?)`,
    )
    .bind(setId, workoutExerciseId, workoutExerciseId, workoutId)
    .run();
  if (!result.meta.changes)
    throw new WorkoutNotFoundError('セットが見つかりません');
  return getWorkout(db, workoutId);
}

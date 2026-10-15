import { minimumSideReps, type RepMode } from './reps';
import type {
  CreateExerciseMasterInput,
  UpdateExerciseMasterInput,
  CreateWorkoutInput,
  Workout,
  WorkoutMutationInput,
  WorkoutMutationOperation,
  WorkoutExercise,
  WorkoutExerciseStatus,
  WorkoutSet,
  WorkoutSetStatus,
  WorkoutStatus,
  WorkoutVersionConflictDetails,
} from './types';

export type ValidationIssue = { path: string; message: string };

export class WorkoutValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super('入力内容を確認してください');
    this.name = 'WorkoutValidationError';
  }
}

export class WorkoutNotFoundError extends Error {
  constructor(message = '対象のデータが見つかりません') {
    super(message);
    this.name = 'WorkoutNotFoundError';
  }
}

export class WorkoutConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkoutConflictError';
  }
}

export class WorkoutVersionConflictError extends Error {
  readonly code = 'WORKOUT_VERSION_CONFLICT';

  constructor(public readonly conflict: WorkoutVersionConflictDetails) {
    super(
      `別の変更が存在します（端末 v${conflict.baseVersion} / サーバー v${conflict.serverVersion}）`,
    );
    this.name = 'WorkoutVersionConflictError';
  }
}

export class WorkoutVersionAheadError extends Error {
  readonly code = 'WORKOUT_VERSION_AHEAD';

  constructor(public readonly conflict: WorkoutVersionConflictDetails) {
    super(
      `端末のbase versionがサーバーより進んでいます（端末 v${conflict.baseVersion} / サーバー v${conflict.serverVersion}）`,
    );
    this.name = 'WorkoutVersionAheadError';
  }
}

const workoutStatuses = new Set<WorkoutStatus>([
  'draft',
  'active',
  'completed',
  'abandoned',
]);
const exerciseStatuses = new Set<WorkoutExerciseStatus>([
  'planned',
  'in_progress',
  'completed',
  'skipped',
]);
const setStatuses = new Set<WorkoutSetStatus>([
  'planned',
  'completed',
  'skipped',
]);
const bodyParts = new Set(['胸', '背中', '脚', '肩', '腕', '体幹', 'その他']);

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  max = 200,
  required = true,
) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) issues.push({ path, message: '必須です' });
  if (result.length > max)
    issues.push({ path, message: `${max}文字以内で入力してください` });
  return result;
}

function nullableText(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  max = 2000,
) {
  if (value === null || value === undefined || value === '') return null;
  return text(value, path, issues, max, false);
}

function integer(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  nullable = false,
) {
  if ((value === null || value === undefined || value === '') && nullable)
    return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    issues.push({ path, message: `${min}〜${max}の整数で入力してください` });
    return nullable ? null : min;
  }
  return value;
}

function timestamp(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  nullable = false,
) {
  if ((value === null || value === undefined || value === '') && nullable)
    return null;
  const result = text(value, path, issues, 64, !nullable);
  if (result && Number.isNaN(Date.parse(result)))
    issues.push({ path, message: '日時の形式が正しくありません' });
  return result || null;
}

function id(value: unknown, path: string, issues: ValidationIssue[]) {
  const result = text(value, path, issues, 100);
  if (result && !/^[A-Za-z0-9_-]+$/.test(result))
    issues.push({ path, message: 'IDの形式が正しくありません' });
  return result;
}

function nullableId(value: unknown, path: string, issues: ValidationIssue[]) {
  if (value === null || value === undefined || value === '') return null;
  return id(value, path, issues);
}

export function normalizeExerciseName(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
}

export function validateCreateWorkoutInput(value: unknown): CreateWorkoutInput {
  const input = record(value);
  const issues: ValidationIssue[] = [];
  const result: CreateWorkoutInput = {
    id: input.id === undefined ? undefined : id(input.id, 'id', issues),
    name: text(input.name, 'name', issues, 80),
    localDate: text(input.localDate, 'localDate', issues, 10),
    timezone: text(input.timezone, 'timezone', issues, 80),
    startedAt:
      input.startedAt === undefined
        ? undefined
        : (timestamp(input.startedAt, 'startedAt', issues) ?? undefined),
  };
  if (result.localDate && !/^\d{4}-\d{2}-\d{2}$/.test(result.localDate))
    issues.push({
      path: 'localDate',
      message: 'YYYY-MM-DD形式で入力してください',
    });
  if (issues.length) throw new WorkoutValidationError(issues);
  return result;
}

function repMode(value: unknown, path: string, issues: ValidationIssue[]): RepMode | undefined {
  if (value === undefined) return undefined;
  if (value === 'standard' || value === 'per_side') return value;
  issues.push({ path, message: '回数の記録方式を選び直してください' });
  return undefined;
}

export function validateExerciseMasterInput(
  value: unknown,
): CreateExerciseMasterInput {
  const input = record(value);
  const issues: ValidationIssue[] = [];
  const name = text(input.name, 'name', issues, 80);
  const bodyPart = text(input.bodyPart, 'bodyPart', issues, 20);
  if (bodyPart && !bodyParts.has(bodyPart))
    issues.push({ path: 'bodyPart', message: '対応していない部位です' });
  const result = {
    id: input.id === undefined ? undefined : id(input.id, 'id', issues),
    name,
    bodyPart,
    ...(input.repMode === undefined ? {} : { repMode: repMode(input.repMode, 'repMode', issues) }),
  };
  if (issues.length) throw new WorkoutValidationError(issues);
  return result;
}

export function validateExerciseMasterUpdate(value: unknown): UpdateExerciseMasterInput {
  const input = record(value);
  const base = validateExerciseMasterInput(input);
  const issues: ValidationIssue[] = [];
  const result = {
    name: base.name,
    bodyPart: base.bodyPart,
    ...(base.repMode ? { repMode: base.repMode } : {}),
    defaultRepMin: integer(input.defaultRepMin, 'defaultRepMin', issues, 1, 999, true),
    defaultRepMax: integer(input.defaultRepMax, 'defaultRepMax', issues, 1, 999, true),
    defaultWorkingSets: integer(input.defaultWorkingSets, 'defaultWorkingSets', issues, 1, 30, true),
    defaultIncrementGrams: integer(input.defaultIncrementGrams, 'defaultIncrementGrams', issues, 1, 100000, true),
    defaultRestSeconds: integer(input.defaultRestSeconds, 'defaultRestSeconds', issues, 0, 3600, true),
  };
  if (result.defaultRepMin !== null && result.defaultRepMax !== null && result.defaultRepMin > result.defaultRepMax) issues.push({ path: 'defaultRepMax', message: 'rep上限は下限以上にしてください' });
  if (issues.length) throw new WorkoutValidationError(issues);
  return result;
}

export function validateWorkoutSet(value: unknown, path = 'set', mode: RepMode = 'standard'): WorkoutSet {
  const input = record(value);
  const issues: ValidationIssue[] = [];
  const status = text(
    input.status,
    `${path}.status`,
    issues,
    20,
  ) as WorkoutSetStatus;
  if (status && !setStatuses.has(status))
    issues.push({
      path: `${path}.status`,
      message: 'セット状態が正しくありません',
    });
  const targetRepMin = integer(
    input.targetRepMin,
    `${path}.targetRepMin`,
    issues,
    0,
    999,
    true,
  );
  const targetRepMax = integer(
    input.targetRepMax,
    `${path}.targetRepMax`,
    issues,
    0,
    999,
    true,
  );
  // Target ordering is advisory, including already queued legacy snapshots.
  // The editor fixes ordering before queueing new edits; never rewrite a mutation.
  const result: WorkoutSet = {
    id: id(input.id, `${path}.id`, issues),
    position: integer(input.position, `${path}.position`, issues, 0, 9999) ?? 0,
    status,
    setType: 'working',
    targetLoadGrams: integer(
      input.targetLoadGrams,
      `${path}.targetLoadGrams`,
      issues,
      0,
      2_000_000,
      true,
    ),
    targetRepMin,
    targetRepMax,
    actualLoadGrams: integer(
      input.actualLoadGrams,
      `${path}.actualLoadGrams`,
      issues,
      0,
      2_000_000,
      true,
    ),
    actualReps: integer(
      input.actualReps,
      `${path}.actualReps`,
      issues,
      0,
      999,
      true,
    ),
    memo: nullableText(input.memo, `${path}.memo`, issues, 2000) ?? '',
    completedAt: timestamp(
      input.completedAt,
      `${path}.completedAt`,
      issues,
      true,
    ),
    createdAt: timestamp(input.createdAt, `${path}.createdAt`, issues) ?? '',
    updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`, issues) ?? '',
  };
  if (mode === 'per_side') {
    result.actualRepsLeft = integer(input.actualRepsLeft, `${path}.actualRepsLeft`, issues, 1, 999, true);
    result.actualRepsRight = integer(input.actualRepsRight, `${path}.actualRepsRight`, issues, 1, 999, true);
    result.actualReps = minimumSideReps(result.actualRepsLeft, result.actualRepsRight);
    if (status === 'completed' && result.actualReps === null) issues.push({ path, message: '右と左の回数を両方入力してください' });
  } else if (input.actualRepsLeft != null || input.actualRepsRight != null) {
    issues.push({ path, message: '左右別の回数は左右別記録の種目で入力してください' });
  }
  if (
    status === 'completed' &&
    (result.actualLoadGrams === null || result.actualReps === null)
  )
    issues.push({ path, message: '完了セットには実績重量とrepが必要です' });
  if (issues.length) throw new WorkoutValidationError(issues);
  return result;
}

export function validateWorkoutExercise(
  value: unknown,
  index = 0,
): WorkoutExercise {
  const input = record(value);
  const path = `exercises.${index}`;
  const issues: ValidationIssue[] = [];
  const status = text(
    input.status,
    `${path}.status`,
    issues,
    20,
  ) as WorkoutExerciseStatus;
  if (status && !exerciseStatuses.has(status))
    issues.push({
      path: `${path}.status`,
      message: '種目状態が正しくありません',
    });
  const mode = repMode(input.repMode, `${path}.repMode`, issues);
  const setInputs = Array.isArray(input.sets) ? input.sets : [];
  if (!Array.isArray(input.sets))
    issues.push({ path: `${path}.sets`, message: 'セット一覧が必要です' });
  const sets: WorkoutSet[] = [];
  for (let setIndex = 0; setIndex < setInputs.length; setIndex += 1) {
    try {
      sets.push(
        validateWorkoutSet(setInputs[setIndex], `${path}.sets.${setIndex}`, mode),
      );
    } catch (error) {
      if (error instanceof WorkoutValidationError) issues.push(...error.issues);
      else throw error;
    }
  }
  const result: WorkoutExercise = {
    id: id(input.id, `${path}.id`, issues),
    exerciseId: id(input.exerciseId, `${path}.exerciseId`, issues),
    position: integer(input.position, `${path}.position`, issues, 0, 9999) ?? 0,
    status,
    ...(mode ? { repMode: mode } : {}),
    exerciseNameSnapshot: text(
      input.exerciseNameSnapshot,
      `${path}.exerciseNameSnapshot`,
      issues,
      80,
    ),
    note: nullableText(input.note, `${path}.note`, issues, 2000) ?? '',
    startedAt: timestamp(input.startedAt, `${path}.startedAt`, issues, true),
    completedAt: timestamp(
      input.completedAt,
      `${path}.completedAt`,
      issues,
      true,
    ),
    createdAt: timestamp(input.createdAt, `${path}.createdAt`, issues) ?? '',
    updatedAt: timestamp(input.updatedAt, `${path}.updatedAt`, issues) ?? '',
    sets: sets.sort((a, b) => a.position - b.position),
  };
  const positions = new Set(result.sets.map((set) => set.position));
  if (positions.size !== result.sets.length)
    issues.push({ path: `${path}.sets`, message: 'セット順が重複しています' });
  if (issues.length) throw new WorkoutValidationError(issues);
  return result;
}

export function validateWorkoutSnapshot(
  value: unknown,
  expectedId?: string,
): Workout {
  const input = record(value);
  const issues: ValidationIssue[] = [];
  const status = text(input.status, 'status', issues, 20) as WorkoutStatus;
  if (status && !workoutStatuses.has(status))
    issues.push({
      path: 'status',
      message: 'ワークアウト状態が正しくありません',
    });
  const exerciseInputs = Array.isArray(input.exercises) ? input.exercises : [];
  if (!Array.isArray(input.exercises))
    issues.push({ path: 'exercises', message: '種目一覧が必要です' });
  const exercises: WorkoutExercise[] = [];
  for (let index = 0; index < exerciseInputs.length; index += 1) {
    try {
      exercises.push(validateWorkoutExercise(exerciseInputs[index], index));
    } catch (error) {
      if (error instanceof WorkoutValidationError) issues.push(...error.issues);
      else throw error;
    }
  }
  const result: Workout = {
    id: id(input.id, 'id', issues),
    name: text(input.name, 'name', issues, 80),
    status,
    localDate: text(input.localDate, 'localDate', issues, 10),
    timezone: text(input.timezone, 'timezone', issues, 80),
    startedAt: timestamp(input.startedAt, 'startedAt', issues) ?? '',
    endedAt: timestamp(input.endedAt, 'endedAt', issues, true),
    overallNote:
      nullableText(input.overallNote, 'overallNote', issues, 4000) ?? '',
    rating: integer(input.rating, 'rating', issues, 1, 5, true),
    version:
      integer(input.version, 'version', issues, 1, Number.MAX_SAFE_INTEGER) ??
      1,
    createdAt: timestamp(input.createdAt, 'createdAt', issues) ?? '',
    updatedAt: timestamp(input.updatedAt, 'updatedAt', issues) ?? '',
    deletedAt: timestamp(input.deletedAt, 'deletedAt', issues, true),
    sourceWorkoutId: nullableId(
      input.sourceWorkoutId,
      'sourceWorkoutId',
      issues,
    ),
    exercises: exercises.sort((a, b) => a.position - b.position),
  };
  if (expectedId && result.id !== expectedId)
    issues.push({ path: 'id', message: 'URLのワークアウトIDと一致しません' });
  if (result.sourceWorkoutId === result.id)
    issues.push({
      path: 'sourceWorkoutId',
      message: 'コピー元と新しいワークアウトのIDは分けてください',
    });
  if (result.localDate && !/^\d{4}-\d{2}-\d{2}$/.test(result.localDate))
    issues.push({
      path: 'localDate',
      message: 'YYYY-MM-DD形式で入力してください',
    });
  const exercisePositions = new Set(
    result.exercises.map((exercise) => exercise.position),
  );
  if (exercisePositions.size !== result.exercises.length)
    issues.push({ path: 'exercises', message: '種目順が重複しています' });
  const exerciseIds = new Set<string>();
  const setIds = new Set<string>();
  for (const exercise of result.exercises) {
    if (exerciseIds.has(exercise.id))
      issues.push({ path: 'exercises', message: '種目IDが重複しています' });
    exerciseIds.add(exercise.id);
    for (const set of exercise.sets) {
      if (setIds.has(set.id))
        issues.push({
          path: 'exercises.sets',
          message: 'セットIDが重複しています',
        });
      setIds.add(set.id);
    }
  }
  if (issues.length) throw new WorkoutValidationError(issues);
  return result;
}

export function validateWorkoutMutation(value: unknown): WorkoutMutationInput {
  const input = record(value);
  const issues: ValidationIssue[] = [];
  const mutationId = id(input.mutationId, 'mutationId', issues);
  const entityType = text(input.entityType, 'entityType', issues, 30);
  if (entityType && entityType !== 'workout') {
    issues.push({ path: 'entityType', message: '対応していない同期対象です' });
  }
  const entityId = id(input.entityId, 'entityId', issues);
  const operation = text(
    input.operation,
    'operation',
    issues,
    20,
  ) as WorkoutMutationOperation;
  if (
    operation &&
    !(
      ['create', 'replace', 'complete', 'edit', 'delete', 'restore'] as const
    ).includes(operation)
  ) {
    issues.push({ path: 'operation', message: '同期操作が正しくありません' });
  }
  const createdAt = timestamp(input.createdAt, 'createdAt', issues) ?? '';
  const baseVersion =
    integer(
      input.baseVersion,
      'baseVersion',
      issues,
      0,
      Number.MAX_SAFE_INTEGER,
    ) ?? 0;
  let workout: Workout | null = null;
  try {
    workout = validateWorkoutSnapshot(record(input.payload).workout, entityId);
  } catch (error) {
    if (error instanceof WorkoutValidationError) issues.push(...error.issues);
    else throw error;
  }
  if (
    ['complete', 'edit', 'delete', 'restore'].includes(operation) &&
    workout?.status !== 'completed'
  ) {
    issues.push({
      path: 'payload.workout.status',
      message: '完了状態が必要です',
    });
  }
  if (
    ['create', 'replace'].includes(operation) &&
    workout?.status !== 'active'
  ) {
    issues.push({
      path: 'payload.workout.status',
      message: '進行中状態が必要です',
    });
  }
  if (issues.length || !workout) throw new WorkoutValidationError(issues);
  return {
    mutationId,
    entityType: 'workout',
    entityId,
    operation,
    baseVersion,
    payload: { workout },
    createdAt,
  };
}

export function toErrorResponse(error: unknown) {
  if (error instanceof WorkoutValidationError)
    return {
      status: 400,
      body: { error: error.message, issues: error.issues },
    };
  if (error instanceof WorkoutNotFoundError)
    return { status: 404, body: { error: error.message } };
  if (error instanceof WorkoutVersionConflictError)
    return {
      status: 409,
      body: {
        error: error.message,
        code: error.code,
        conflict: error.conflict,
      },
    };
  if (error instanceof WorkoutVersionAheadError)
    return {
      status: 409,
      body: {
        error: error.message,
        code: error.code,
        conflict: error.conflict,
      },
    };
  if (error instanceof WorkoutConflictError)
    return { status: 409, body: { error: error.message } };
  const message =
    error instanceof Error ? error.message : '予期しないエラーが発生しました';
  return { status: 500, body: { error: message } };
}

import type {
  ExerciseMaster,
  Workout,
  WorkoutMutation,
  WorkoutMutationOperation,
  WorkoutMutationSyncStatus,
  WorkoutSummary,
} from './types';

export const LOCAL_DRAFT_DATABASE_NAME = 'repwise-local';
export const LOCAL_DRAFT_STORE_NAME = 'workoutDrafts';
export const WORKOUT_MUTATION_STORE_NAME = 'workoutMutationQueue';
export const EXERCISE_MASTER_CACHE_STORE_NAME = 'exerciseMasterCache';
export const LOCAL_DRAFT_SCHEMA_VERSION = 1;
export const LOCAL_DATABASE_VERSION = 3;
export const COMPLETED_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type LocalDraftStatus =
  | 'active'
  | 'completed'
  | 'completed_edit'
  | 'deleted';

export interface LocalWorkoutDraft {
  workoutId: string;
  schemaVersion: typeof LOCAL_DRAFT_SCHEMA_VERSION;
  draftStatus: LocalDraftStatus;
  workout: Workout;
  localUpdatedAt: string;
  serverUpdatedAt: string | null;
  serverVersion: number | null;
  completedAt: string | null;
}

export type WorkoutRestoreResult = {
  workout: Workout | null;
  source: 'local' | 'server' | 'none';
};

const databases = new Map<string, Promise<IDBDatabase>>();
let lastMutationSequence = 0;

function getIndexedDb() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('このブラウザではIndexedDBを利用できません');
  }
  return indexedDB;
}

function openDatabase(databaseName = LOCAL_DRAFT_DATABASE_NAME) {
  const cached = databases.get(databaseName);
  if (cached) return cached;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = getIndexedDb().open(databaseName, LOCAL_DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LOCAL_DRAFT_STORE_NAME)) {
        const store = database.createObjectStore(LOCAL_DRAFT_STORE_NAME, {
          keyPath: 'workoutId',
        });
        store.createIndex('draftStatus', 'draftStatus', { unique: false });
        store.createIndex('localUpdatedAt', 'localUpdatedAt', {
          unique: false,
        });
      }
      if (!database.objectStoreNames.contains(WORKOUT_MUTATION_STORE_NAME)) {
        const store = database.createObjectStore(WORKOUT_MUTATION_STORE_NAME, {
          keyPath: 'mutationId',
        });
        store.createIndex('sequence', 'sequence', { unique: true });
        store.createIndex('workoutId', 'workoutId', { unique: false });
        store.createIndex('syncStatus', 'syncStatus', { unique: false });
      }
      if (
        !database.objectStoreNames.contains(EXERCISE_MASTER_CACHE_STORE_NAME)
      ) {
        database.createObjectStore(EXERCISE_MASTER_CACHE_STORE_NAME, {
          keyPath: 'key',
        });
      }
      if (
        event.oldVersion > 0 &&
        event.oldVersion < 3 &&
        database.objectStoreNames.contains(WORKOUT_MUTATION_STORE_NAME)
      ) {
        const store = request.transaction?.objectStore(
          WORKOUT_MUTATION_STORE_NAME,
        );
        const expectedVersions = new Map<string, number>();
        const cursorRequest = store?.index('sequence').openCursor();
        if (cursorRequest) {
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const value = cursor.value as Partial<WorkoutMutation>;
            const workoutId = String(value.workoutId ?? value.entityId ?? '');
            const payloadVersion = Number(value.payload?.workout?.version ?? 1);
            const baseVersion =
              value.operation === 'create'
                ? 0
                : (expectedVersions.get(workoutId) ?? payloadVersion);
            expectedVersions.set(workoutId, baseVersion + 1);
            cursor.update({ ...value, baseVersion });
            cursor.continue();
          };
        }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databases.delete(databaseName);
      };
      resolve(database);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDBを開けませんでした'));
    request.onblocked = () =>
      reject(new Error('IndexedDBの更新がブロックされました'));
  });
  databases.set(databaseName, opening);
  opening.catch(() => databases.delete(databaseName));
  return opening;
}

function notifyQueueChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('repwise-sync-queue-change'));
  }
}

function nextMutationSequence() {
  const base = Date.now() * 1000;
  lastMutationSequence = Math.max(base, lastMutationSequence + 1);
  return lastMutationSequence;
}

function createDraftRecord(
  workout: Workout,
  draftStatus: LocalDraftStatus,
  options: { localUpdatedAt?: string; serverUpdatedAt?: string | null } = {},
): LocalWorkoutDraft {
  const timestamp = options.localUpdatedAt ?? new Date().toISOString();
  return {
    workoutId: workout.id,
    schemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
    draftStatus,
    workout: structuredClone(workout),
    localUpdatedAt: timestamp,
    serverUpdatedAt:
      'serverUpdatedAt' in options
        ? (options.serverUpdatedAt ?? null)
        : (workout.updatedAt ?? null),
    serverVersion: workout.version ?? null,
    completedAt:
      draftStatus === 'active' ? null : (workout.endedAt ?? timestamp),
  };
}

function createMutationRecord(
  workout: Workout,
  operation: WorkoutMutationOperation,
  createdAt: string,
  baseVersion: number,
): WorkoutMutation {
  return {
    mutationId: crypto.randomUUID(),
    entityType: 'workout',
    entityId: workout.id,
    workoutId: workout.id,
    operation,
    baseVersion,
    payload: { workout: structuredClone(workout) },
    createdAt,
    sequence: nextMutationSequence(),
    retryCount: 0,
    syncStatus: 'pending',
    lastAttemptAt: null,
    lastError: null,
  };
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDBの操作に失敗しました'));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDBの保存に失敗しました'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDBの保存が中断されました'));
  });
}

function isLocalWorkoutDraft(value: unknown): value is LocalWorkoutDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<LocalWorkoutDraft>;
  const valid =
    draft.schemaVersion === LOCAL_DRAFT_SCHEMA_VERSION &&
    typeof draft.workoutId === 'string' &&
    ['active', 'completed', 'completed_edit', 'deleted'].includes(
      draft.draftStatus ?? '',
    ) &&
    typeof draft.localUpdatedAt === 'string' &&
    !!draft.workout &&
    draft.workout.id === draft.workoutId;
  if (
    valid &&
    !Object.prototype.hasOwnProperty.call(draft.workout, 'deletedAt')
  ) {
    (draft.workout as Workout).deletedAt = null;
  }
  if (
    valid &&
    !Object.prototype.hasOwnProperty.call(draft.workout, 'sourceWorkoutId')
  ) {
    (draft.workout as Workout).sourceWorkoutId = null;
  }
  return valid;
}

export async function saveActiveWorkoutDraft(
  workout: Workout,
  options: {
    localUpdatedAt?: string;
    serverUpdatedAt?: string | null;
    databaseName?: string;
  } = {},
) {
  const database = await openDatabase(options.databaseName);
  const transaction = database.transaction(LOCAL_DRAFT_STORE_NAME, 'readwrite');
  const complete = transactionComplete(transaction);
  const record = createDraftRecord(workout, 'active', options);
  transaction.objectStore(LOCAL_DRAFT_STORE_NAME).put(record);
  await complete;
  return record;
}

export async function saveCompletedWorkoutEditDraft(
  workout: Workout,
  options: {
    localUpdatedAt?: string;
    serverUpdatedAt?: string | null;
    databaseName?: string;
  } = {},
) {
  const database = await openDatabase(options.databaseName);
  const transaction = database.transaction(LOCAL_DRAFT_STORE_NAME, 'readwrite');
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const currentValue = await requestResult(store.get(workout.id));
  const current = isLocalWorkoutDraft(currentValue) ? currentValue : null;
  const record = createDraftRecord(workout, 'completed_edit', {
    ...options,
    serverUpdatedAt:
      options.serverUpdatedAt ?? current?.serverUpdatedAt ?? workout.updatedAt,
  });
  record.serverVersion =
    current?.draftStatus === 'completed_edit'
      ? current.serverVersion
      : workout.version;
  store.put(record);
  await complete;
  return record;
}

export async function saveWorkoutDraftAndEnqueueMutation(
  workout: Workout,
  operation: WorkoutMutationOperation,
  options: {
    localUpdatedAt?: string;
    serverUpdatedAt?: string | null;
    databaseName?: string;
  } = {},
) {
  const database = await openDatabase(options.databaseName);
  const transaction = database.transaction(
    [LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME],
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const localUpdatedAt = options.localUpdatedAt ?? new Date().toISOString();
  const draft = createDraftRecord(
    workout,
    operation === 'delete'
      ? 'deleted'
      : operation === 'edit'
        ? 'completed_edit'
        : operation === 'complete' || operation === 'restore'
          ? 'completed'
          : 'active',
    { ...options, localUpdatedAt },
  );
  const drafts = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const queue = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const [currentDraftValue, queuedValues] = await Promise.all([
    requestResult(drafts.get(workout.id)),
    requestResult(queue.index('workoutId').getAll(workout.id)),
  ]);
  const existingMutations = queuedValues
    .filter(isWorkoutMutation)
    .sort((a, b) => a.sequence - b.sequence);
  const superseded =
    operation === 'replace' || operation === 'edit'
      ? existingMutations.filter(
          (value) =>
            value.operation === operation &&
            value.syncStatus === 'pending' &&
            value.retryCount === 0,
        )
      : [];
  const supersededIds = new Set(superseded.map((value) => value.mutationId));
  const remainingPredecessors = existingMutations.filter(
    (value) => !supersededIds.has(value.mutationId),
  );
  const lastPredecessor = remainingPredecessors.at(-1);
  const currentDraft = isLocalWorkoutDraft(currentDraftValue)
    ? currentDraftValue
    : null;
  if (currentDraft) {
    draft.serverUpdatedAt = currentDraft.serverUpdatedAt;
    draft.serverVersion = currentDraft.serverVersion;
  }
  const baseVersion =
    operation === 'create'
      ? 0
      : Math.max(
          0,
          lastPredecessor
            ? lastPredecessor.baseVersion + 1
            : (currentDraft?.serverVersion ?? workout.version),
        );
  const mutation = createMutationRecord(
    workout,
    operation,
    localUpdatedAt,
    baseVersion,
  );
  drafts.put(draft);
  for (const value of superseded) {
    queue.delete(value.mutationId);
  }
  queue.put(mutation);
  await complete;
  notifyQueueChanged();
  return { draft, mutation };
}

function isWorkoutMutation(value: unknown): value is WorkoutMutation {
  if (!value || typeof value !== 'object') return false;
  const mutation = value as Partial<WorkoutMutation>;
  return (
    typeof mutation.mutationId === 'string' &&
    mutation.entityType === 'workout' &&
    typeof mutation.entityId === 'string' &&
    typeof mutation.workoutId === 'string' &&
    ['create', 'replace', 'complete', 'edit', 'delete', 'restore'].includes(
      mutation.operation ?? '',
    ) &&
    typeof mutation.baseVersion === 'number' &&
    Number.isInteger(mutation.baseVersion) &&
    mutation.baseVersion >= 0 &&
    typeof mutation.createdAt === 'string' &&
    typeof mutation.sequence === 'number' &&
    typeof mutation.retryCount === 'number' &&
    ['pending', 'syncing', 'failed', 'blocked', 'conflict'].includes(
      mutation.syncStatus ?? '',
    ) &&
    !!mutation.payload?.workout
  );
}

export async function listWorkoutMutations(
  workoutId?: string,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    WORKOUT_MUTATION_STORE_NAME,
    'readonly',
  );
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const values = workoutId
    ? await requestResult(store.index('workoutId').getAll(workoutId))
    : await requestResult(store.getAll());
  await complete;
  return values
    .filter(isWorkoutMutation)
    .sort((a, b) => a.sequence - b.sequence);
}

export async function updateWorkoutMutation(
  mutationId: string,
  values: Partial<
    Pick<
      WorkoutMutation,
      'syncStatus' | 'retryCount' | 'lastAttemptAt' | 'lastError'
    >
  >,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    WORKOUT_MUTATION_STORE_NAME,
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const current = await requestResult(store.get(mutationId));
  if (isWorkoutMutation(current)) store.put({ ...current, ...values });
  await complete;
  notifyQueueChanged();
}

export async function resetBlockedWorkoutMutations(
  workoutId: string,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const mutations = await listWorkoutMutations(workoutId, databaseName);
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    WORKOUT_MUTATION_STORE_NAME,
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  for (const mutation of mutations) {
    if (mutation.syncStatus === 'blocked') {
      store.put({
        ...mutation,
        syncStatus: 'pending' satisfies WorkoutMutationSyncStatus,
        lastError: null,
      });
    }
  }
  await complete;
  notifyQueueChanged();
}

export async function acknowledgeWorkoutMutation(
  mutation: WorkoutMutation,
  serverWorkout: Workout,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    [LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME],
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const queue = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const drafts = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  queue.delete(mutation.mutationId);
  const currentRequest = drafts.get(mutation.workoutId);
  const remainingRequest = queue.index('workoutId').getAll(mutation.workoutId);
  const current = await requestResult(currentRequest);
  const remaining = (await requestResult(remainingRequest)).filter(
    isWorkoutMutation,
  );
  if (isLocalWorkoutDraft(current)) {
    const hasLaterMutation = remaining.some(
      (queued) => queued.sequence > mutation.sequence,
    );
    const isLatestSnapshot =
      !hasLaterMutation && current.localUpdatedAt <= mutation.createdAt;
    const syncedWorkout = isLatestSnapshot
      ? structuredClone(serverWorkout)
      : current.workout;
    const acknowledgedDraftStatus: LocalDraftStatus =
      mutation.operation === 'delete'
        ? 'deleted'
        : mutation.operation === 'edit' ||
            mutation.operation === 'restore' ||
            mutation.operation === 'complete'
          ? 'completed'
          : 'active';
    drafts.put({
      ...current,
      workout: syncedWorkout,
      draftStatus: hasLaterMutation
        ? current.draftStatus
        : acknowledgedDraftStatus,
      completedAt:
        syncedWorkout.status === 'completed'
          ? (syncedWorkout.endedAt ?? current.completedAt)
          : current.completedAt,
      serverUpdatedAt: serverWorkout.updatedAt,
      serverVersion: serverWorkout.version,
    } satisfies LocalWorkoutDraft);
  }
  await complete;
  notifyQueueChanged();
}

export async function getLocalWorkoutDraft(
  workoutId: string,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(LOCAL_DRAFT_STORE_NAME, 'readonly');
  const complete = transactionComplete(transaction);
  const result = await requestResult(
    transaction.objectStore(LOCAL_DRAFT_STORE_NAME).get(workoutId),
  );
  await complete;
  return isLocalWorkoutDraft(result) ? result : null;
}

export async function getLatestActiveWorkoutDraft(
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(LOCAL_DRAFT_STORE_NAME, 'readonly');
  const complete = transactionComplete(transaction);
  const values = await requestResult(
    transaction.objectStore(LOCAL_DRAFT_STORE_NAME).getAll(),
  );
  await complete;
  return (
    values
      .filter(isLocalWorkoutDraft)
      .filter(
        (draft) =>
          draft.draftStatus === 'active' && draft.workout.status === 'active',
      )
      .sort((a, b) => b.localUpdatedAt.localeCompare(a.localUpdatedAt))[0] ??
    null
  );
}

export async function markLocalWorkoutDraftCompleted(
  workout: Workout,
  options: { localUpdatedAt?: string; databaseName?: string } = {},
) {
  const database = await openDatabase(options.databaseName);
  const transaction = database.transaction(LOCAL_DRAFT_STORE_NAME, 'readwrite');
  const complete = transactionComplete(transaction);
  const timestamp = options.localUpdatedAt ?? new Date().toISOString();
  const record = createDraftRecord(workout, 'completed', {
    localUpdatedAt: timestamp,
    serverUpdatedAt: workout.updatedAt,
  });
  transaction.objectStore(LOCAL_DRAFT_STORE_NAME).put(record);
  await complete;
  return record;
}

export async function pruneCompletedWorkoutDrafts(
  now = Date.now(),
  retentionMs = COMPLETED_DRAFT_RETENTION_MS,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    [LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME],
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const queue = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const values = await requestResult(store.getAll());
  let removed = 0;
  for (const value of values) {
    if (!isLocalWorkoutDraft(value) || value.draftStatus !== 'completed')
      continue;
    const completedAt = Date.parse(value.completedAt ?? value.localUpdatedAt);
    const pending = await requestResult(
      queue.index('workoutId').getAll(value.workoutId),
    );
    if (
      !pending.length &&
      Number.isFinite(completedAt) &&
      now - completedAt >= retentionMs
    ) {
      store.delete(value.workoutId);
      removed += 1;
    }
  }
  await complete;
  return removed;
}

export function selectWorkoutDetailForDisplay(
  serverWorkout: Workout | null,
  localDraft: LocalWorkoutDraft | null,
  hasPendingMutations = false,
  serverKnownMissing = false,
  missingServerVersion: number | null = null,
): WorkoutRestoreResult {
  if (!localDraft) {
    return serverWorkout
      ? { workout: serverWorkout, source: 'server' }
      : { workout: null, source: 'none' };
  }
  if (
    serverKnownMissing &&
    // A later acknowledged restore advances version and supersedes the 404.
    (missingServerVersion === null ||
      localDraft.workout.version <= missingServerVersion) &&
    localDraft.draftStatus === 'completed' &&
    !hasPendingMutations
  ) {
    return { workout: null, source: 'none' };
  }
  if (!serverWorkout) return { workout: localDraft.workout, source: 'local' };
  if (
    localDraft.draftStatus === 'completed_edit' ||
    localDraft.draftStatus === 'deleted'
  )
    return { workout: localDraft.workout, source: 'local' };
  if (hasPendingMutations)
    return { workout: localDraft.workout, source: 'local' };
  const localUpdatedAt = Date.parse(localDraft.localUpdatedAt);
  const serverUpdatedAt = Date.parse(serverWorkout.updatedAt);
  if (Number.isFinite(localUpdatedAt) && localUpdatedAt >= serverUpdatedAt) {
    return { workout: localDraft.workout, source: 'local' };
  }
  return { workout: serverWorkout, source: 'server' };
}

export async function saveExerciseMasterCache(
  exercises: ExerciseMaster[],
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    EXERCISE_MASTER_CACHE_STORE_NAME,
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  transaction.objectStore(EXERCISE_MASTER_CACHE_STORE_NAME).put({
    key: 'all',
    exercises: structuredClone(exercises),
    updatedAt: new Date().toISOString(),
  });
  await complete;
}

export async function getExerciseMasterCache(
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  return (await getExerciseMasterCacheRecord(databaseName))?.exercises ?? [];
}

export interface ExerciseMasterCacheRecord {
  exercises: ExerciseMaster[];
  updatedAt: string;
  revision: number;
}

export async function getExerciseMasterCacheRecord(
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
): Promise<ExerciseMasterCacheRecord | null> {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    EXERCISE_MASTER_CACHE_STORE_NAME,
    'readonly',
  );
  const complete = transactionComplete(transaction);
  const value = (await requestResult(
    transaction.objectStore(EXERCISE_MASTER_CACHE_STORE_NAME).get('all'),
  )) as
    | { exercises?: unknown; updatedAt?: string; revision?: number }
    | undefined;
  await complete;
  return Array.isArray(value?.exercises)
    ? {
        exercises: value.exercises as ExerciseMaster[],
        updatedAt: value.updatedAt ?? '',
        revision: value.revision ?? 0,
      }
    : null;
}

// Only the master-cache store is touched. Workout drafts/queue schema and
// transactions are unchanged. The revision rejects a GET that started before
// a successful master creation/change (including from another tab).
export async function updateExerciseMasterCache(
  exercises: ExerciseMaster[],
  expectedRevision: number,
  startedAt: string,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    EXERCISE_MASTER_CACHE_STORE_NAME,
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(EXERCISE_MASTER_CACHE_STORE_NAME);
  const current = (await requestResult(store.get('all'))) as
    | ExerciseMasterCacheRecord
    | undefined;
  const accepted =
    (current?.revision ?? 0) === expectedRevision &&
    !(Date.parse(current?.updatedAt ?? '') > Date.parse(startedAt));
  if (accepted)
    store.put({
      key: 'all',
      exercises: structuredClone(exercises),
      updatedAt: startedAt,
      revision: expectedRevision,
    });
  await complete;
  return accepted;
}

export async function invalidateExerciseMasterCacheRecord(
  changed?: ExerciseMaster,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    EXERCISE_MASTER_CACHE_STORE_NAME,
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(EXERCISE_MASTER_CACHE_STORE_NAME);
  const current = (await requestResult(store.get('all'))) as
    | ExerciseMasterCacheRecord
    | undefined;
  const exercises = (current?.exercises ?? []).filter(
    (item) => item.id !== changed?.id,
  );
  if (changed) exercises.push(changed);
  store.put({
    key: 'all',
    exercises,
    updatedAt: '',
    revision: (current?.revision ?? 0) + 1,
  });
  await complete;
}

export function selectWorkoutForRestore(
  serverWorkout: Workout | null,
  localDraft: LocalWorkoutDraft | null,
  hasPendingMutations = false,
): WorkoutRestoreResult {
  if (serverWorkout && serverWorkout.status !== 'active') {
    return { workout: serverWorkout, source: 'server' };
  }
  if (
    !localDraft ||
    localDraft.draftStatus !== 'active' ||
    localDraft.workout.status !== 'active'
  ) {
    return serverWorkout
      ? { workout: serverWorkout, source: 'server' }
      : { workout: null, source: 'none' };
  }
  if (!serverWorkout) return { workout: localDraft.workout, source: 'local' };
  if (hasPendingMutations)
    return { workout: localDraft.workout, source: 'local' };

  const localUpdatedAt = Date.parse(localDraft.localUpdatedAt);
  const serverUpdatedAt = Date.parse(serverWorkout.updatedAt);
  if (Number.isFinite(localUpdatedAt) && localUpdatedAt >= serverUpdatedAt) {
    return { workout: localDraft.workout, source: 'local' };
  }
  return { workout: serverWorkout, source: 'server' };
}

export function workoutToSummary(workout: Workout): WorkoutSummary {
  const sets = workout.exercises.flatMap((exercise) => exercise.sets);
  const completedSets = sets.filter((set) => set.status === 'completed');
  return {
    id: workout.id,
    name: workout.name,
    status: workout.status,
    localDate: workout.localDate,
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    exerciseCount: workout.exercises.length,
    setCount: sets.length,
    completedSetCount: completedSets.length,
    totalVolumeGrams: completedSets.reduce(
      (total, set) =>
        total + (set.actualLoadGrams ?? 0) * (set.actualReps ?? 0),
      0,
    ),
  };
}

export async function closeLocalDraftDatabase(
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
) {
  const database = databases.get(databaseName);
  databases.delete(databaseName);
  if (database)
    await database.then((value) => value.close()).catch(() => undefined);
}

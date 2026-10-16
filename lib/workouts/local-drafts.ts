import { totalReps } from '@/lib/workouts/reps';
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
export const SYNC_RECOVERY_STORE_NAME = 'syncRecoveryArchive';
export const LOCAL_DRAFT_SCHEMA_VERSION = 1;
export const LOCAL_DATABASE_VERSION = 4;
export const COMPLETED_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type LocalDraftStatus =
  | 'active'
  | 'completed'
  | 'completed_edit'
  | 'deleted';

export interface LocalWorkoutDraft {
  permanentDeletionRequested?: boolean;
  permanentDeletionConfirmed?: boolean;
  automaticDeletionRepairVersion?: number;
  deletionConfirmedAt?: string;
  editBaseline?: Workout;
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

export type WorkoutMutationClaim =
  | { status: 'claimed'; mutation: WorkoutMutation }
  | { status: 'stopped'; mutation: WorkoutMutation }
  | { status: 'empty'; mutation: null };

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
      if (!database.objectStoreNames.contains(SYNC_RECOVERY_STORE_NAME)) {
        database.createObjectStore(SYNC_RECOVERY_STORE_NAME, { keyPath: 'id' });
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
            request.transaction?.objectStore(SYNC_RECOVERY_STORE_NAME).put({ id: `upgrade:${String(value.mutationId)}`, reason: 'pre-v3-original', mutation: cursor.value });
            // Never change a request that may already have reached the server.
            if ((value.retryCount ?? 0) > 0 || value.lastAttemptAt) {
              cursor.continue();
              return;
            }
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
    try { window.localStorage.setItem('repwise-sync-notification', crypto.randomUUID()); } catch { /* IndexedDB remains the source of truth. */ }
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
  const store = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const value = await requestResult(store.get(workout.id));
  if (isLocalWorkoutDraft(value) &&
      (value.draftStatus !== 'active' || value.localUpdatedAt > record.localUpdatedAt)) {
    await complete;
    return value;
  }
  store.put(record);
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
  if (current?.draftStatus === 'deleted' || current?.workout.deletedAt) throw new Error('削除済みの記録は編集できません');
  const record = createDraftRecord(workout, 'completed_edit', {
    ...options,
    serverUpdatedAt:
      options.serverUpdatedAt ?? current?.serverUpdatedAt ?? workout.updatedAt,
  });
  if (workout.status !== 'completed' || workout.deletedAt) throw new Error('完了済みの記録だけを編集できます');
  const baseline = current?.draftStatus === 'completed_edit' ? current.editBaseline : workout;
  if (baseline) record.editBaseline = structuredClone(baseline);
  record.serverVersion =
    current?.draftStatus === 'completed_edit'
      ? current.serverVersion
      : Math.max(workout.version, current?.serverVersion ?? 0);
  store.put(record);
  await complete;
  return record;
}

// Cancel only the unsubmitted editor draft; immutable queued changes remain intact.
export async function cancelCompletedWorkoutEdit(workoutId: string, options: { serverWorkout?: Workout | null; databaseName?: string } = {}) {
  const database = await openDatabase(options.databaseName);
  const transaction = database.transaction([LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME], 'readwrite');
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const value = await requestResult(store.get(workoutId));
  const current = isLocalWorkoutDraft(value) ? value : null;
  const pending = (await requestResult(transaction.objectStore(WORKOUT_MUTATION_STORE_NAME).index('workoutId').getAll(workoutId))).filter(isWorkoutMutation).sort((a, b) => b.sequence - a.sequence);
  if (!current || current.draftStatus !== 'completed_edit') {
    await complete;
    if (current?.workout.status === 'completed' && !current.workout.deletedAt) return current.workout;
    throw new Error('完了状態を確認できません。編集内容は保持されています。');
  }
  const queued = pending[0]?.payload.workout;
  const server = options.serverWorkout;
  const baseline = current.editBaseline ?? (queued?.status === 'completed' && !queued.deletedAt ? queued : null) ?? (server?.status === 'completed' && !server.deletedAt ? server : null);
  if (!baseline || baseline.status !== 'completed' || baseline.deletedAt) {
    await complete;
    throw new Error('編集前の完了記録を確認できません。編集内容は保持されています。');
  }
  const restored = createDraftRecord({ ...baseline, version: Math.max(baseline.version, current.serverVersion ?? 0) }, 'completed', { serverUpdatedAt: current.serverUpdatedAt });
  restored.serverVersion = current.serverVersion;
  store.put(restored);
  await complete;
  return restored.workout;
}

export async function saveWorkoutDraftAndEnqueueMutation(
  workout: Workout,
  operation: WorkoutMutationOperation,
  options: {
    permanentDelete?: boolean;
    localUpdatedAt?: string;
    serverUpdatedAt?: string | null;
    databaseName?: string;
  } = {},
) {
  const database = await openDatabase(options.databaseName);
  const transaction = database.transaction(
    [LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME, SYNC_RECOVERY_STORE_NAME],
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
        : operation === 'restore'
          ? (workout.status === 'active' ? 'active' : 'completed')
          : operation === 'complete'
          ? 'completed'
          : 'active',
    { ...options, localUpdatedAt },
  );
  const drafts = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const queue = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const [currentDraftValue, queuedValues] = await Promise.all([
    requestResult(drafts.get(workout.id)),
    requestResult(queue.getAll()).then(values => values.filter(value => mutationBelongsTo(value, workout.id))),
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
  if (currentDraft &&
      ((operation === 'delete' && currentDraft.draftStatus === 'deleted' && !options.permanentDelete) ||
       (operation === 'restore' && currentDraft.draftStatus !== 'deleted') ||
       (currentDraft.draftStatus === 'deleted' && operation !== 'restore' && operation !== 'delete'))) {
    await complete;
    throw new Error('削除状態が変更されています。一覧を更新してください。');
  }
  if (operation === 'replace' && currentDraft && currentDraft.draftStatus !== 'active') {
    await complete;
    throw new Error('このトレーニングは終了済みです。履歴から確認・編集してください。');
  }
  if (currentDraft) {
    draft.serverUpdatedAt = currentDraft.serverUpdatedAt;
    draft.serverVersion = currentDraft.serverVersion;
  }
  const baseVersion =
    operation === 'create'
      ? 0
      : options.permanentDelete
        ? Math.max(0, currentDraft?.serverUpdatedAt === null ? 0 : (currentDraft?.serverVersion ?? workout.version))
      : Math.max(
          0,
          lastPredecessor
            ? lastPredecessor.baseVersion + 1
            : (currentDraft?.serverVersion ?? workout.version),
        );
  const lastQueued = await requestResult(queue.index('sequence').openCursor(IDBKeyRange.bound(0, Number.MAX_SAFE_INTEGER - 1), 'prev'));
  const mutation = createMutationRecord(
    workout,
    operation,
    localUpdatedAt,
    baseVersion,
  );
  if (operation === 'delete' && options.permanentDelete) {
    transaction.objectStore(SYNC_RECOVERY_STORE_NAME).put({ id: crypto.randomUUID(), reason: 'permanent-delete-request', draft: currentDraftValue, mutations: queuedValues });
    for (const old of queuedValues) queue.delete(old.mutationId);
    mutation.payload.permanentDelete = true;
    mutation.payload.workout = { id: workout.id, name: '削除済み', status: 'active', localDate: localUpdatedAt.slice(0, 10), timezone: 'UTC', startedAt: localUpdatedAt, endedAt: null, overallNote: '', rating: null, version: baseVersion, createdAt: localUpdatedAt, updatedAt: localUpdatedAt, deletedAt: localUpdatedAt, sourceWorkoutId: null, exercises: [] };
    draft.permanentDeletionRequested = true;
  }
  mutation.sequence = Math.max(mutation.sequence, Number(lastQueued?.key ?? 0) + 1);
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

function mutationBelongsTo(value: unknown, workoutId: string) {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WorkoutMutation>;
  return item.workoutId === workoutId || item.entityId === workoutId || item.payload?.workout?.id === workoutId;
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

export async function claimNextWorkoutMutation(
  workoutId: string,
  options: { databaseName?: string; lastAttemptAt?: string } = {},
): Promise<WorkoutMutationClaim> {
  const database = await openDatabase(options.databaseName);
  const transaction = database.transaction(
    [WORKOUT_MUTATION_STORE_NAME, LOCAL_DRAFT_STORE_NAME],
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const draft = await requestResult(transaction.objectStore(LOCAL_DRAFT_STORE_NAME).get(workoutId));
  if (draft && !isLocalWorkoutDraft(draft)) {
    await complete;
    throw new Error('旧形式の記録を保護しています。設定から原本を書き出して確認してください。');
  }
  const values = (await requestResult(store.getAll())).filter((value) => mutationBelongsTo(value, workoutId));
  if (values.some((value) => !isWorkoutMutation(value))) {
    await complete;
    throw new Error('旧形式の変更を保護しています。設定の復旧管理から原本を書き出してください。');
  }
  const mutation = values
    .filter(isWorkoutMutation)
    .sort((a, b) => a.sequence - b.sequence)[0];

  if (!mutation) {
    await complete;
    return { status: 'empty', mutation: null };
  }
  if (mutation.syncStatus === 'conflict' || mutation.syncStatus === 'blocked' ||
      (mutation.syncStatus === 'syncing' && mutation.lastAttemptAt &&
        Date.parse(options.lastAttemptAt ?? new Date().toISOString()) - Date.parse(mutation.lastAttemptAt) < 60_000)) {
    await complete;
    return { status: 'stopped', mutation };
  }

  const claimed: WorkoutMutation = {
    ...mutation,
    syncStatus: 'syncing',
    retryCount: mutation.retryCount + 1,
    lastAttemptAt: options.lastAttemptAt ?? new Date().toISOString(),
    lastError: null,
  };
  store.put(claimed);
  await complete;
  notifyQueueChanged();
  return { status: 'claimed', mutation: claimed };
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
  const database = await openDatabase(databaseName);
  const transaction = database.transaction(
    WORKOUT_MUTATION_STORE_NAME,
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const mutations = (await requestResult(store.index('workoutId').getAll(workoutId))).filter(isWorkoutMutation);
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
    [LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME, SYNC_RECOVERY_STORE_NAME],
    'readwrite',
  );
  const complete = transactionComplete(transaction);
  const queue = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const drafts = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  // An old response in another tab must not overwrite a newer acknowledged delete.
  const queued = await requestResult(queue.get(mutation.mutationId));
  if (!queued) { await complete; return; }
  queue.delete(mutation.mutationId);
  const currentRequest = drafts.get(mutation.workoutId);
  const remainingRequest = queue.index('workoutId').getAll(mutation.workoutId);
  const current = await requestResult(currentRequest);
  const remaining = (await requestResult(remainingRequest)).filter(
    isWorkoutMutation,
  );
  if (isLocalWorkoutDraft(current)) {
    let hasLaterMutation = remaining.some(
      (queued) => queued.sequence > mutation.sequence,
    );
    const isLatestSnapshot =
      !hasLaterMutation && current.localUpdatedAt <= mutation.createdAt;
    const hasUnsubmittedEdit = current.draftStatus === 'completed_edit' && (Boolean(current.editBaseline) || !isLatestSnapshot);
    const permanent = mutation.operation === 'delete' && mutation.payload.permanentDelete === true;
    if (permanent) { for (const value of (await requestResult(queue.getAll()))) if (mutationBelongsTo(value, mutation.workoutId)) queue.delete(value.mutationId); hasLaterMutation = false; }
    const syncedWorkout = permanent ? { ...structuredClone(serverWorkout), name: '削除済み', overallNote: '', rating: null, exercises: [] } : isLatestSnapshot && !hasUnsubmittedEdit
      ? structuredClone(serverWorkout)
      : current.workout;
    const acknowledgedDraftStatus: LocalDraftStatus =
      mutation.operation === 'delete'
        ? 'deleted'
        : mutation.operation === 'restore'
          ? (serverWorkout.status === 'active' ? 'active' : 'completed')
        : mutation.operation === 'edit' ||
            mutation.operation === 'complete'
          ? 'completed'
          : 'active';
    if (permanent) {
      const archive = transaction.objectStore(SYNC_RECOVERY_STORE_NAME);
      const originals = await requestResult(archive.getAll());
      for (const original of originals) {
        if (original.draft?.workoutId === mutation.workoutId || mutationBelongsTo(original.mutation, mutation.workoutId) || (Array.isArray(original.mutations) && original.mutations.some((value: unknown) => mutationBelongsTo(value, mutation.workoutId)))) archive.delete(original.id);
      }
    }
    drafts.put({
      ...current,
      ...(permanent ? { permanentDeletionConfirmed: true, editBaseline: undefined } : {}),
      workout: syncedWorkout,
      draftStatus: permanent ? 'deleted' : hasLaterMutation || hasUnsubmittedEdit || !isLatestSnapshot
        ? current.draftStatus
        : acknowledgedDraftStatus,
      ...(hasUnsubmittedEdit && current.editBaseline && !hasLaterMutation && serverWorkout.status === 'completed'
        ? { editBaseline: { ...current.editBaseline, version: serverWorkout.version, updatedAt: serverWorkout.updatedAt } } : {}),
      ...(!hasLaterMutation && mutation.operation === 'delete' && serverWorkout.deletedAt ? { deletionConfirmedAt: new Date().toISOString() } : {}),
      completedAt: permanent ? null :
        syncedWorkout.status === 'completed'
          ? (syncedWorkout.endedAt ?? current.completedAt)
          : current.completedAt,
      serverUpdatedAt: serverWorkout.updatedAt,
      serverVersion: Math.max(current.serverVersion ?? 0, serverWorkout.version),
    } satisfies LocalWorkoutDraft);
  }
  await complete;
  notifyQueueChanged();
}

export async function readLocalWorkoutSources(databaseName = LOCAL_DRAFT_DATABASE_NAME) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction([LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME], 'readonly');
  const complete = transactionComplete(transaction);
  const [drafts, mutations] = await Promise.all([
    requestResult(transaction.objectStore(LOCAL_DRAFT_STORE_NAME).getAll()),
    requestResult(transaction.objectStore(WORKOUT_MUTATION_STORE_NAME).getAll()),
  ]);
  await complete;
  return { drafts: drafts.filter(isLocalWorkoutDraft), mutations: mutations.filter(isWorkoutMutation),
    unreadableDrafts: drafts.filter((value) => !isLocalWorkoutDraft(value)),
    unreadableMutations: mutations.filter((value) => !isWorkoutMutation(value)) };
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
  const transaction = database.transaction([LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME], 'readwrite');
  const complete = transactionComplete(transaction);
  const timestamp = options.localUpdatedAt ?? new Date().toISOString();
  const record = createDraftRecord(workout, 'completed', {
    localUpdatedAt: timestamp,
    serverUpdatedAt: workout.updatedAt,
  });
  const store = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const current = await requestResult(store.get(workout.id));
  const pending = await requestResult(transaction.objectStore(WORKOUT_MUTATION_STORE_NAME).index('workoutId').getAll(workout.id));
  if (isLocalWorkoutDraft(current) && (current.draftStatus === 'deleted' || current.draftStatus === 'completed_edit' || pending.length || (current.serverVersion ?? 0) > workout.version)) {
    await complete;
    return current;
  }
  store.put(record);
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
  const queued = await requestResult(queue.getAll());
  let removed = 0;
  for (const value of values) {
    if (!isLocalWorkoutDraft(value) || value.draftStatus !== 'completed' ||
        value.workout.status !== 'completed' || value.workout.deletedAt ||
        !value.serverUpdatedAt || value.serverVersion === null || value.serverVersion < value.workout.version)
      continue;
    const completedAt = Date.parse(value.completedAt ?? value.localUpdatedAt);
    const pending = queued.filter((item) => mutationBelongsTo(item, value.workoutId));
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
  if (localDraft?.draftStatus === 'completed_edit' && localDraft.workout.status !== 'completed' && localDraft.editBaseline?.status === 'completed') {
    return { workout: { ...localDraft.workout, status: 'completed', endedAt: localDraft.editBaseline.endedAt }, source: 'local' };
  }
  if (localDraft?.draftStatus === 'completed' && localDraft.workout.status !== 'completed') {
    return serverWorkout?.status === 'completed' ? { workout: serverWorkout, source: 'server' } : { workout: null, source: 'none' };
  }
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

export async function repairCompletedWorkoutDraft(server: Workout, databaseName = LOCAL_DRAFT_DATABASE_NAME) {
  if (server.deletedAt) return;
  const database = await openDatabase(databaseName);
  const transaction = database.transaction([LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME, SYNC_RECOVERY_STORE_NAME], 'readwrite');
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const value = await requestResult(store.get(server.id));
  const pending = (await requestResult(transaction.objectStore(WORKOUT_MUTATION_STORE_NAME).index('workoutId').getAll(server.id))).filter(isWorkoutMutation).sort((a, b) => b.sequence - a.sequence);
  if (isLocalWorkoutDraft(value) && value.draftStatus === 'completed' && value.workout.status !== 'completed') {
    const latest = pending[0]?.payload.workout;
    const queuedCompleted = latest?.status === 'completed' && !latest.deletedAt ? latest : null;
    if (pending.length && queuedCompleted) {
      const repaired = createDraftRecord(queuedCompleted, 'completed', { serverUpdatedAt: value.serverUpdatedAt });
      repaired.serverVersion = value.serverVersion;
      transaction.objectStore(SYNC_RECOVERY_STORE_NAME).put({ id: crypto.randomUUID(), reason: 'completed-cache-repair', draft: value });
      store.put(repaired);
    } else if (!pending.length && server.status === 'completed' && server.version >= (value.serverVersion ?? value.workout.version)) {
      transaction.objectStore(SYNC_RECOVERY_STORE_NAME).put({ id: crypto.randomUUID(), reason: 'completed-cache-repair', draft: value });
      store.put(createDraftRecord(server, 'completed'));
    }
  }
  await complete;
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
  if (localDraft?.draftStatus === 'deleted' || localDraft?.workout.deletedAt) return { workout: null, source: 'none' };
  if (serverWorkout && serverWorkout.status !== 'active') {
    return { workout: serverWorkout, source: 'server' };
  }
  if (localDraft?.workout.status === 'completed' &&
      ['completed', 'completed_edit'].includes(localDraft.draftStatus) &&
      ((!serverWorkout && hasPendingMutations) || (serverWorkout && (hasPendingMutations || (localDraft.serverVersion ?? localDraft.workout.version) >= serverWorkout.version)))) {
    return { workout: localDraft.workout, source: 'local' };
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
        total + (set.actualLoadGrams ?? 0) * totalReps(set),
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

// Archive before any repair. Originals are intentionally retained without TTL.
export async function exportWorkoutRecoveryData(databaseName = LOCAL_DRAFT_DATABASE_NAME) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction([LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME, SYNC_RECOVERY_STORE_NAME], 'readonly');
  const complete = transactionComplete(transaction);
  const [drafts, mutations, recoveryArchive] = await Promise.all([
    requestResult(transaction.objectStore(LOCAL_DRAFT_STORE_NAME).getAll()),
    requestResult(transaction.objectStore(WORKOUT_MUTATION_STORE_NAME).getAll()),
    requestResult(transaction.objectStore(SYNC_RECOVERY_STORE_NAME).getAll()),
  ]);
  await complete;
  return { drafts, mutations, recoveryArchive };
}

export async function recoverLegacyWorkoutQueue(databaseName = LOCAL_DRAFT_DATABASE_NAME) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction([LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME, SYNC_RECOVERY_STORE_NAME], 'readwrite');
  const complete = transactionComplete(transaction);
  const drafts = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const queue = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const archive = transaction.objectStore(SYNC_RECOVERY_STORE_NAME);
  const raw = await requestResult(queue.getAll());
  const unknown = raw.filter((value) => !isWorkoutMutation(value));
  const values = raw.filter(isWorkoutMutation).sort((a, b) => a.sequence - b.sequence);
  let repaired = 0;
  for (const mutation of values) {
    if (unknown.some((value) => mutationBelongsTo(value, mutation.workoutId))) continue;
    // Only this obsolete, precisely identified API validation is automatically retried once.
    if ((mutation.operation === 'delete' || mutation.operation === 'restore') &&
        mutation.payload.workout.status === 'active' && (mutation.syncStatus === 'blocked' || mutation.syncStatus === 'failed') &&
        mutation.lastError?.includes('payload.workout.status: 完了状態が必要です') &&
        !await requestResult(archive.get(`status-contract:${mutation.mutationId}`))) {
      archive.put({ id: `status-contract:${mutation.mutationId}`, reason: 'active-status-contract', mutation });
      queue.put({ ...mutation, syncStatus: 'pending', lastError: null });
      repaired++;
    }
    if (values.some((later) => later.workoutId === mutation.workoutId && later.sequence > mutation.sequence)) continue;
    const current = await requestResult(drafts.get(mutation.workoutId));
    if (current && !isLocalWorkoutDraft(current)) continue;
    // A persisted final delete proves local intent, even if an old ACK rewrote its cache.
    if (mutation.operation === 'delete' &&
        (!isLocalWorkoutDraft(current) || (current.localUpdatedAt <= mutation.createdAt && current.draftStatus !== 'completed_edit')) &&
        (!isLocalWorkoutDraft(current) || current.draftStatus !== 'deleted' || !current.workout.deletedAt)) {
      archive.put({ id: `tombstone:${mutation.mutationId}`, reason: 'restore-local-delete-intent', draft: current, mutation });
      const tombstone = { ...mutation.payload.workout, deletedAt: mutation.payload.workout.deletedAt ?? mutation.createdAt };
      const draft = createDraftRecord(tombstone, 'deleted', { localUpdatedAt: mutation.createdAt });
      if (isLocalWorkoutDraft(current)) { draft.serverVersion = current.serverVersion; draft.serverUpdatedAt = current.serverUpdatedAt; }
      drafts.put(draft);
      repaired++;
    }
  }
  await complete;
  if (repaired) notifyQueueChanged();
  return repaired;
}

// Explicit per-record repair: preserve obsolete requests, then apply only the user's final delete.
// The server snapshot comes from an owner-scoped read including tombstones. API version checks
// still guard the new delete if the server changes after this read.
export async function reconcileDeletedWorkout(
  workoutId: string,
  server: Workout | null,
  expected: { draft: LocalWorkoutDraft; mutations: WorkoutMutation[] },
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
  automatic = false,
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction([LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME, SYNC_RECOVERY_STORE_NAME], 'readwrite');
  const complete = transactionComplete(transaction);
  const drafts = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const queue = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const current = await requestResult(drafts.get(workoutId));
  const raw = (await requestResult(queue.getAll())).filter((value) => mutationBelongsTo(value, workoutId));
  const mutations = raw.filter(isWorkoutMutation).sort((a, b) => a.sequence - b.sequence);
  if (JSON.stringify(current) !== JSON.stringify(expected.draft) || JSON.stringify(mutations) !== JSON.stringify(expected.mutations) ||
      raw.length !== mutations.length || !isLocalWorkoutDraft(current) || current.draftStatus !== 'deleted' || !current.workout.deletedAt ||
      (mutations.length > 0 && mutations.at(-1)?.operation !== 'delete') ||
      mutations.some((item) => item.syncStatus === 'syncing') || (server && server.id !== workoutId) ||
      !server ||
      (automatic && current.automaticDeletionRepairVersion !== undefined) ||
      (server?.deletedAt && mutations.some((item) => (item.retryCount > 0 || item.lastAttemptAt) && item.baseVersion >= server.version))) {
    await complete;
    throw new Error('削除状態が変更されたか、判断できない変更があります。再読み込みして原本を確認してください。');
  }
  transaction.objectStore(SYNC_RECOVERY_STORE_NAME).put({
    id: crypto.randomUUID(), reason: automatic ? 'automatic-delete-reconciliation' : 'explicit-delete-reconciliation', recoveredAt: new Date().toISOString(), draft: current, mutations, server,
  });
  for (const item of mutations) queue.delete(item.mutationId);
  if (server && !server.deletedAt) {
    const deleted = { ...structuredClone(server), deletedAt: current.workout.deletedAt };
    const mutation = createMutationRecord(deleted, 'delete', new Date().toISOString(), server.version);
    if (current.permanentDeletionRequested) mutation.payload.permanentDelete = true;
    const last = await requestResult(queue.index('sequence').openCursor(IDBKeyRange.bound(0, Number.MAX_SAFE_INTEGER - 1), 'prev'));
    mutation.sequence = Math.max(mutation.sequence, Number(last?.key ?? 0) + 1);
    queue.put(mutation);
    drafts.put({ ...current, ...(automatic ? { automaticDeletionRepairVersion: server.version } : {}), localUpdatedAt: mutation.createdAt, serverVersion: server.version });
  } else {
    // An existing server tombstone needs no new mutation. Keep local tombstone.
    drafts.put({ ...current, ...(automatic ? { automaticDeletionRepairVersion: server.version } : {}), serverVersion: server.version, serverUpdatedAt: server.updatedAt, deletionConfirmedAt: new Date().toISOString() });
  }
  await complete;
  notifyQueueChanged();
}


// A new, explicit correction can replace rejected requests, never an in-flight or
// accepted request. Keep originals until the user permanently deletes the record.
export async function replaceRejectedWorkoutChanges(
  workoutId: string,
  expected: { draft: LocalWorkoutDraft; mutations: WorkoutMutation[] },
  serverVersion: number,
  databaseName = LOCAL_DRAFT_DATABASE_NAME,
  operation?: 'replace' | 'complete' | 'edit',
) {
  const database = await openDatabase(databaseName);
  const transaction = database.transaction([LOCAL_DRAFT_STORE_NAME, WORKOUT_MUTATION_STORE_NAME, SYNC_RECOVERY_STORE_NAME], 'readwrite');
  const complete = transactionComplete(transaction);
  const queue = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
  const draft = await requestResult(transaction.objectStore(LOCAL_DRAFT_STORE_NAME).get(workoutId));
  const raw = (await requestResult(queue.getAll())).filter(value => mutationBelongsTo(value, workoutId));
  const mutations = raw.filter(isWorkoutMutation).sort((a, b) => a.sequence - b.sequence);
  const head = mutations[0];
  const latest = mutations.at(-1);
  if (JSON.stringify(draft) !== JSON.stringify(expected.draft) || JSON.stringify(mutations) !== JSON.stringify(expected.mutations) ||
      raw.length !== mutations.length || !head || !latest || head === latest || head.syncStatus !== 'blocked' || !head.lastError?.includes('HTTP 400') ||
      head.baseVersion !== serverVersion || latest.syncStatus !== 'pending' || latest.retryCount !== 0 ||
      mutations.some(item => item.syncStatus === 'syncing' || item.syncStatus === 'conflict' || item.operation === 'delete' || item.operation === 'restore')) {
    await complete;
    return false;
  }
  transaction.objectStore(SYNC_RECOVERY_STORE_NAME).put({ id: crypto.randomUUID(), reason: 'explicit-input-correction', draft, mutations });
  for (const item of mutations) queue.delete(item.mutationId);
  const correction = createMutationRecord(latest.payload.workout, operation ?? latest.operation, latest.createdAt, serverVersion);
  const last = await requestResult(queue.index('sequence').openCursor(IDBKeyRange.bound(0, Number.MAX_SAFE_INTEGER - 1), 'prev'));
  correction.sequence = Math.max(correction.sequence, Number(last?.key ?? 0) + 1);
  queue.put(correction);
  await complete;
  notifyQueueChanged();
  return true;
}

export async function upgradeHiddenDeletion(workoutId: string, databaseName = LOCAL_DRAFT_DATABASE_NAME) {
  const draft = await getLocalWorkoutDraft(workoutId, databaseName);
  if (!draft || draft.draftStatus !== 'deleted' || draft.permanentDeletionConfirmed) return;
  const queue = await listWorkoutMutations(workoutId, databaseName);
  if (queue.some(item => item.payload.permanentDelete)) return;
  await saveWorkoutDraftAndEnqueueMutation(draft.workout, 'delete', { databaseName, permanentDelete: true });
}

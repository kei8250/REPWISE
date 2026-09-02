import type { Workout, WorkoutSummary } from './types';

export const LOCAL_DRAFT_DATABASE_NAME = 'repwise-local';
export const LOCAL_DRAFT_STORE_NAME = 'workoutDrafts';
export const LOCAL_DRAFT_SCHEMA_VERSION = 1;
export const COMPLETED_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type LocalDraftStatus = 'active' | 'completed';

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
    const request = getIndexedDb().open(
      databaseName,
      LOCAL_DRAFT_SCHEMA_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(LOCAL_DRAFT_STORE_NAME)) return;
      const store = database.createObjectStore(LOCAL_DRAFT_STORE_NAME, {
        keyPath: 'workoutId',
      });
      store.createIndex('draftStatus', 'draftStatus', { unique: false });
      store.createIndex('localUpdatedAt', 'localUpdatedAt', { unique: false });
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
  return (
    draft.schemaVersion === LOCAL_DRAFT_SCHEMA_VERSION &&
    typeof draft.workoutId === 'string' &&
    (draft.draftStatus === 'active' || draft.draftStatus === 'completed') &&
    typeof draft.localUpdatedAt === 'string' &&
    !!draft.workout &&
    draft.workout.id === draft.workoutId
  );
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
  const record: LocalWorkoutDraft = {
    workoutId: workout.id,
    schemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
    draftStatus: 'active',
    workout: structuredClone(workout),
    localUpdatedAt: options.localUpdatedAt ?? new Date().toISOString(),
    serverUpdatedAt: options.serverUpdatedAt ?? workout.updatedAt ?? null,
    serverVersion: workout.version ?? null,
    completedAt: null,
  };
  transaction.objectStore(LOCAL_DRAFT_STORE_NAME).put(record);
  await complete;
  return record;
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
  const record: LocalWorkoutDraft = {
    workoutId: workout.id,
    schemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
    draftStatus: 'completed',
    workout: structuredClone(workout),
    localUpdatedAt: timestamp,
    serverUpdatedAt: workout.updatedAt,
    serverVersion: workout.version,
    completedAt: workout.endedAt ?? timestamp,
  };
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
  const transaction = database.transaction(LOCAL_DRAFT_STORE_NAME, 'readwrite');
  const complete = transactionComplete(transaction);
  const store = transaction.objectStore(LOCAL_DRAFT_STORE_NAME);
  const values = await requestResult(store.getAll());
  let removed = 0;
  for (const value of values) {
    if (!isLocalWorkoutDraft(value) || value.draftStatus !== 'completed')
      continue;
    const completedAt = Date.parse(value.completedAt ?? value.localUpdatedAt);
    if (Number.isFinite(completedAt) && now - completedAt >= retentionMs) {
      store.delete(value.workoutId);
      removed += 1;
    }
  }
  await complete;
  return removed;
}

export function selectWorkoutForRestore(
  serverWorkout: Workout | null,
  localDraft: LocalWorkoutDraft | null,
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

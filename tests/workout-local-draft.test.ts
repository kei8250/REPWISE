import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeLocalDraftDatabase,
  getLatestActiveWorkoutDraft,
  getLocalWorkoutDraft,
  listWorkoutMutations,
  LOCAL_DRAFT_STORE_NAME,
  LOCAL_DRAFT_DATABASE_NAME,
  markLocalWorkoutDraftCompleted,
  pruneCompletedWorkoutDrafts,
  saveActiveWorkoutDraft,
  saveCompletedWorkoutEditDraft,
  saveWorkoutDraftAndEnqueueMutation,
  selectWorkoutDetailForDisplay,
  selectWorkoutForRestore,
  WORKOUT_MUTATION_STORE_NAME,
} from '@/lib/workouts/local-drafts';
import type {
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '@/lib/workouts/types';

const serverTime = '2026-09-02T08:00:00.000Z';
const localTime = '2026-09-02T08:05:00.000Z';

function workoutSet(
  id: string,
  position: number,
  load: number,
  reps: number,
): WorkoutSet {
  return {
    id,
    position,
    status: position === 0 ? 'completed' : 'planned',
    setType: 'working',
    targetLoadGrams: load + 2500,
    targetRepMin: reps,
    targetRepMax: reps + 2,
    actualLoadGrams: load,
    actualReps: reps,
    memo: `${id}のセットメモ`,
    completedAt: position === 0 ? localTime : null,
    createdAt: serverTime,
    updatedAt: localTime,
  };
}

function workoutExercise(
  id: string,
  position: number,
  setCount: number,
): WorkoutExercise {
  return {
    id,
    exerciseId: `master-${id}`,
    position,
    status: position === 0 ? 'completed' : 'in_progress',
    exerciseNameSnapshot: `種目${position + 1}`,
    note: `${id}の種目メモ`,
    startedAt: serverTime,
    completedAt: position === 0 ? localTime : null,
    createdAt: serverTime,
    updatedAt: localTime,
    sets: Array.from({ length: setCount }, (_, index) =>
      workoutSet(
        `${id}-set-${index + 1}`,
        index,
        60_000 + position * 10_000,
        10 - index,
      ),
    ),
  };
}

function activeWorkout(): Workout {
  return {
    id: 'phase-1b-local-workout',
    name: 'Phase 1B-1a ローカル復元',
    status: 'active',
    localDate: '2026-09-02',
    timezone: 'Asia/Tokyo',
    startedAt: serverTime,
    endedAt: null,
    overallNote: 'ワークアウト全体メモ',
    rating: null,
    version: 2,
    createdAt: serverTime,
    updatedAt: serverTime,
    deletedAt: null,
    exercises: [
      workoutExercise('bench', 0, 3),
      workoutExercise('row', 1, 2),
      workoutExercise('squat', 2, 4),
    ],
  };
}

async function deleteDatabase() {
  await closeLocalDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DRAFT_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('テストDBを削除できませんでした'));
  });
}

beforeEach(deleteDatabase);

describe('Phase 1B-1a IndexedDB local drafts', () => {
  it('複数種目・複数セットとtarget／actual・メモ・完了状態・順序を保存する', async () => {
    const workout = activeWorkout();
    await saveActiveWorkoutDraft(workout, {
      localUpdatedAt: localTime,
      serverUpdatedAt: serverTime,
    });

    const saved = await getLocalWorkoutDraft(workout.id);
    expect(saved?.draftStatus).toBe('active');
    expect(saved?.localUpdatedAt).toBe(localTime);
    expect(saved?.serverUpdatedAt).toBe(serverTime);
    expect(saved?.workout.overallNote).toBe('ワークアウト全体メモ');
    expect(
      saved?.workout.exercises.map((exercise) => exercise.position),
    ).toEqual([0, 1, 2]);
    expect(
      saved?.workout.exercises.map((exercise) => exercise.sets.length),
    ).toEqual([3, 2, 4]);
    const firstSet = saved?.workout.exercises[0].sets[0];
    expect(firstSet).toMatchObject({
      position: 0,
      status: 'completed',
      targetLoadGrams: 62_500,
      targetRepMin: 10,
      targetRepMax: 12,
      actualLoadGrams: 60_000,
      actualReps: 10,
      memo: 'bench-set-1のセットメモ',
    });
    expect(saved?.workout.exercises[0]).toMatchObject({
      status: 'completed',
      note: 'benchの種目メモ',
    });
  });

  it('ブラウザ再読み込み相当でDB接続を閉じても同じ内容を復元する', async () => {
    const workout = activeWorkout();
    await saveActiveWorkoutDraft(workout, { localUpdatedAt: localTime });
    await closeLocalDraftDatabase();

    const restored = await getLocalWorkoutDraft(workout.id);
    expect(restored?.workout).toEqual(workout);
  });

  it('ローカルの方が新しい場合は古いサーバーデータで上書きしない', () => {
    const serverWorkout = activeWorkout();
    const localWorkout = structuredClone(serverWorkout);
    localWorkout.overallNote = 'サーバーにはまだない最新入力';
    const result = selectWorkoutForRestore(serverWorkout, {
      workoutId: localWorkout.id,
      schemaVersion: 1,
      draftStatus: 'active',
      workout: localWorkout,
      localUpdatedAt: localTime,
      serverUpdatedAt: serverTime,
      serverVersion: serverWorkout.version,
      completedAt: null,
    });

    expect(result.source).toBe('local');
    expect(result.workout?.overallNote).toBe('サーバーにはまだない最新入力');
  });

  it('サーバーが新しい場合はサーバーデータを採用する', () => {
    const serverWorkout = activeWorkout();
    serverWorkout.updatedAt = '2026-09-02T08:10:00.000Z';
    serverWorkout.overallNote = '新しいサーバーデータ';
    const localWorkout = activeWorkout();
    localWorkout.overallNote = '古いローカルデータ';
    const result = selectWorkoutForRestore(serverWorkout, {
      workoutId: localWorkout.id,
      schemaVersion: 1,
      draftStatus: 'active',
      workout: localWorkout,
      localUpdatedAt: localTime,
      serverUpdatedAt: serverTime,
      serverVersion: localWorkout.version,
      completedAt: null,
    });

    expect(result.source).toBe('server');
    expect(result.workout?.overallNote).toBe('新しいサーバーデータ');
  });

  it('未同期mutationがある場合は時刻差にかかわらずローカルを採用する', () => {
    const serverWorkout = activeWorkout();
    serverWorkout.updatedAt = '2026-09-02T08:10:00.000Z';
    const localWorkout = activeWorkout();
    localWorkout.overallNote = '同期待ちの入力';
    const result = selectWorkoutForRestore(
      serverWorkout,
      {
        workoutId: localWorkout.id,
        schemaVersion: 1,
        draftStatus: 'active',
        workout: localWorkout,
        localUpdatedAt: localTime,
        serverUpdatedAt: serverTime,
        serverVersion: localWorkout.version,
        completedAt: null,
      },
      true,
    );

    expect(result.source).toBe('local');
    expect(result.workout?.overallNote).toBe('同期待ちの入力');
  });

  it('完了済みワークアウトを進行中として復元しない', async () => {
    const completed = activeWorkout();
    completed.status = 'completed';
    completed.endedAt = '2026-09-02T09:00:00.000Z';
    completed.updatedAt = completed.endedAt;
    await markLocalWorkoutDraftCompleted(completed);

    expect(await getLatestActiveWorkoutDraft()).toBeNull();
    const stored = await getLocalWorkoutDraft(completed.id);
    expect(stored?.draftStatus).toBe('completed');
    expect(selectWorkoutForRestore(null, stored)).toEqual({
      workout: null,
      source: 'none',
    });
  });

  it('下書き保存とmutation登録を同じIndexedDBへFIFO順で保持する', async () => {
    const workout = activeWorkout();
    const created = await saveWorkoutDraftAndEnqueueMutation(
      workout,
      'create',
      { serverUpdatedAt: null },
    );
    workout.overallNote = 'オフライン中の変更';
    workout.updatedAt = localTime;
    const replaced = await saveWorkoutDraftAndEnqueueMutation(
      workout,
      'replace',
      { localUpdatedAt: localTime, serverUpdatedAt: null },
    );

    const queue = await listWorkoutMutations(workout.id);
    expect(queue.map((item) => item.operation)).toEqual(['create', 'replace']);
    expect(queue[0]).toMatchObject({
      mutationId: created.mutation.mutationId,
      entityType: 'workout',
      entityId: workout.id,
      retryCount: 0,
      syncStatus: 'pending',
      baseVersion: 0,
    });
    expect(queue[1].sequence).toBeGreaterThan(queue[0].sequence);
    expect(queue[1].mutationId).toBe(replaced.mutation.mutationId);
    expect(queue[1].baseVersion).toBe(1);
    expect(queue[1].payload.workout.overallNote).toBe('オフライン中の変更');
    expect((await getLocalWorkoutDraft(workout.id))?.workout.overallNote).toBe(
      'オフライン中の変更',
    );
  });

  it('未送信・未試行のreplaceだけを最新スナップショットへ集約する', async () => {
    const workout = activeWorkout();
    await saveWorkoutDraftAndEnqueueMutation(workout, 'create');
    workout.overallNote = '古い未送信入力';
    await saveWorkoutDraftAndEnqueueMutation(workout, 'replace');
    workout.overallNote = '最新の未送信入力';
    await saveWorkoutDraftAndEnqueueMutation(workout, 'replace');

    const queue = await listWorkoutMutations(workout.id);
    expect(queue.map((item) => item.operation)).toEqual(['create', 'replace']);
    expect(queue.map((item) => item.baseVersion)).toEqual([0, 1]);
    expect(queue[1].payload.workout.overallNote).toBe('最新の未送信入力');
  });

  it('認識済みserver versionとFIFO上の先行mutationからbase versionを決める', async () => {
    const workout = activeWorkout();
    workout.version = 5;
    await saveActiveWorkoutDraft(workout, {
      serverUpdatedAt: workout.updatedAt,
    });
    await saveWorkoutDraftAndEnqueueMutation(workout, 'replace');
    workout.overallNote = '先行mutationに続く完了';
    workout.status = 'completed';
    workout.endedAt = localTime;
    await saveWorkoutDraftAndEnqueueMutation(workout, 'complete');

    expect(
      (await listWorkoutMutations(workout.id)).map((item) => ({
        operation: item.operation,
        baseVersion: item.baseVersion,
      })),
    ).toEqual([
      { operation: 'replace', baseVersion: 5 },
      { operation: 'complete', baseVersion: 6 },
    ]);
  });

  it('UIスナップショットの古いversionで認識済みserver versionを巻き戻さない', async () => {
    const serverWorkout = activeWorkout();
    serverWorkout.version = 5;
    await saveActiveWorkoutDraft(serverWorkout, {
      serverUpdatedAt: serverWorkout.updatedAt,
    });

    const localSnapshot = structuredClone(serverWorkout);
    localSnapshot.version = 1;
    localSnapshot.overallNote = '同期後に続けて入力';
    const { mutation } = await saveWorkoutDraftAndEnqueueMutation(
      localSnapshot,
      'replace',
    );

    expect(mutation.baseVersion).toBe(5);
    expect((await getLocalWorkoutDraft(localSnapshot.id))?.serverVersion).toBe(
      5,
    );
  });

  it('未同期の完了mutationがある下書きは保持期間を過ぎても削除しない', async () => {
    const completed = activeWorkout();
    completed.status = 'completed';
    completed.endedAt = serverTime;
    await saveWorkoutDraftAndEnqueueMutation(completed, 'complete', {
      localUpdatedAt: serverTime,
    });

    const removed = await pruneCompletedWorkoutDrafts(
      Date.parse(serverTime) + 8 * 24 * 60 * 60 * 1000,
    );
    expect(removed).toBe(0);
    expect(await getLocalWorkoutDraft(completed.id)).not.toBeNull();
  });

  it('Phase 1B-1bの既存キューをbase version付きで安全にアップグレードする', async () => {
    const databaseName = `${LOCAL_DRAFT_DATABASE_NAME}-legacy-upgrade`;
    await closeLocalDraftDatabase(databaseName);
    await new Promise<void>((resolve, reject) => {
      const deleting = indexedDB.deleteDatabase(databaseName);
      deleting.onsuccess = () => resolve();
      deleting.onerror = () => reject(deleting.error);
    });
    const legacy = activeWorkout();
    legacy.version = 5;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(databaseName, 2);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore(LOCAL_DRAFT_STORE_NAME, {
          keyPath: 'workoutId',
        });
        const queue = opening.result.createObjectStore(
          WORKOUT_MUTATION_STORE_NAME,
          { keyPath: 'mutationId' },
        );
        queue.createIndex('sequence', 'sequence', { unique: true });
        queue.createIndex('workoutId', 'workoutId', { unique: false });
        queue.createIndex('syncStatus', 'syncStatus', { unique: false });
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const transaction = database.transaction(
      WORKOUT_MUTATION_STORE_NAME,
      'readwrite',
    );
    const store = transaction.objectStore(WORKOUT_MUTATION_STORE_NAME);
    store.put({
      mutationId: 'legacy-replace-1',
      entityType: 'workout',
      entityId: legacy.id,
      workoutId: legacy.id,
      operation: 'replace',
      payload: { workout: legacy },
      createdAt: serverTime,
      sequence: 1,
      retryCount: 1,
      syncStatus: 'failed',
      lastAttemptAt: serverTime,
      lastError: 'response lost',
    });
    store.put({
      mutationId: 'legacy-replace-2',
      entityType: 'workout',
      entityId: legacy.id,
      workoutId: legacy.id,
      operation: 'replace',
      payload: { workout: legacy },
      createdAt: localTime,
      sequence: 2,
      retryCount: 0,
      syncStatus: 'pending',
      lastAttemptAt: null,
      lastError: null,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    expect(
      (await listWorkoutMutations(legacy.id, databaseName)).map(
        (item) => item.baseVersion,
      ),
    ).toEqual([5, 6]);
    await closeLocalDraftDatabase(databaseName);
  });

  it('完了済み編集を進行中下書きと分離し、再読み込み後も復元する', async () => {
    const server = activeWorkout();
    server.status = 'completed';
    server.endedAt = localTime;
    server.version = 4;
    const edited = structuredClone(server);
    edited.name = '再読み込み後も残る編集';
    edited.exercises[0].sets[0].actualLoadGrams = 72_500;
    await saveCompletedWorkoutEditDraft(edited, {
      localUpdatedAt: localTime,
      serverUpdatedAt: serverTime,
    });
    await closeLocalDraftDatabase();

    const restored = await getLocalWorkoutDraft(edited.id);
    expect(restored).toMatchObject({
      draftStatus: 'completed_edit',
      serverVersion: 4,
      workout: { name: '再読み込み後も残る編集' },
    });
    expect(await getLatestActiveWorkoutDraft()).toBeNull();
    const newerServer = structuredClone(server);
    newerServer.updatedAt = '2026-09-02T09:00:00.000Z';
    expect(
      selectWorkoutDetailForDisplay(newerServer, restored).workout?.name,
    ).toBe('再読み込み後も残る編集');
  });

  it('未送信の完了済みeditを集約し、delete・restoreをFIFOでversion接続する', async () => {
    const completed = activeWorkout();
    completed.status = 'completed';
    completed.endedAt = localTime;
    completed.version = 7;
    await markLocalWorkoutDraftCompleted(completed);
    completed.overallNote = '古い編集';
    await saveWorkoutDraftAndEnqueueMutation(completed, 'edit');
    completed.overallNote = '最新編集';
    await saveWorkoutDraftAndEnqueueMutation(completed, 'edit');
    const deleted = { ...completed, deletedAt: localTime };
    await saveWorkoutDraftAndEnqueueMutation(deleted, 'delete');
    await saveWorkoutDraftAndEnqueueMutation(
      { ...deleted, deletedAt: null },
      'restore',
    );

    expect(
      (await listWorkoutMutations(completed.id)).map((item) => ({
        operation: item.operation,
        baseVersion: item.baseVersion,
        note: item.payload.workout.overallNote,
      })),
    ).toEqual([
      { operation: 'edit', baseVersion: 7, note: '最新編集' },
      { operation: 'delete', baseVersion: 8, note: '最新編集' },
      { operation: 'restore', baseVersion: 9, note: '最新編集' },
    ]);
    expect((await getLocalWorkoutDraft(completed.id))?.draftStatus).toBe(
      'completed',
    );
  });

  it('保存途中の完了済み編集は保持期間を過ぎても削除しない', async () => {
    const completed = activeWorkout();
    completed.status = 'completed';
    completed.endedAt = serverTime;
    await saveCompletedWorkoutEditDraft(completed, {
      localUpdatedAt: serverTime,
    });

    const removed = await pruneCompletedWorkoutDrafts(
      Date.parse(serverTime) + 30 * 24 * 60 * 60 * 1000,
    );
    expect(removed).toBe(0);
    expect((await getLocalWorkoutDraft(completed.id))?.draftStatus).toBe(
      'completed_edit',
    );
  });
});

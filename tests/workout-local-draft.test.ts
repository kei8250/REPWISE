import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeLocalDraftDatabase,
  getLatestActiveWorkoutDraft,
  getLocalWorkoutDraft,
  listWorkoutMutations,
  LOCAL_DRAFT_DATABASE_NAME,
  markLocalWorkoutDraftCompleted,
  pruneCompletedWorkoutDrafts,
  saveActiveWorkoutDraft,
  saveWorkoutDraftAndEnqueueMutation,
  selectWorkoutForRestore,
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
    });
    expect(queue[1].sequence).toBeGreaterThan(queue[0].sequence);
    expect(queue[1].mutationId).toBe(replaced.mutation.mutationId);
    expect(queue[1].payload.workout.overallNote).toBe('オフライン中の変更');
    expect((await getLocalWorkoutDraft(workout.id))?.workout.overallNote).toBe(
      'オフライン中の変更',
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
});

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { copyWorkoutForToday } from '@/lib/workouts/draft';
import {
  closeLocalDraftDatabase,
  getLocalWorkoutDraft,
  listWorkoutMutations,
  LOCAL_DRAFT_DATABASE_NAME,
  saveWorkoutDraftAndEnqueueMutation,
} from '@/lib/workouts/local-drafts';
import type { Workout } from '@/lib/workouts/types';

const sourceTime = '2026-09-03T10:00:00.000Z';
const copiedTime = '2026-09-04T08:30:00.000Z';

function sourceWorkout(): Workout {
  return {
    id: 'source-workout',
    name: '前回の胸トレ',
    status: 'completed',
    localDate: '2026-09-03',
    timezone: 'Asia/Tokyo',
    startedAt: sourceTime,
    endedAt: sourceTime,
    overallNote: '前回の全体メモ',
    rating: 5,
    version: 7,
    createdAt: sourceTime,
    updatedAt: sourceTime,
    deletedAt: null,
    sourceWorkoutId: null,
    exercises: [
      {
        id: 'source-row',
        exerciseId: 'ex-seated-row',
        position: 1,
        status: 'completed',
        exerciseNameSnapshot: 'シーテッドロー',
        note: '胸を張る',
        startedAt: sourceTime,
        completedAt: sourceTime,
        createdAt: sourceTime,
        updatedAt: sourceTime,
        sets: [
          {
            id: 'source-row-set',
            position: 0,
            status: 'completed',
            setType: 'working',
            targetLoadGrams: null,
            targetRepMin: null,
            targetRepMax: null,
            actualLoadGrams: 55_000,
            actualReps: 11,
            memo: '前回は余裕あり',
            completedAt: sourceTime,
            createdAt: sourceTime,
            updatedAt: sourceTime,
          },
        ],
      },
      {
        id: 'source-bench',
        exerciseId: 'ex-bench-press',
        position: 0,
        status: 'completed',
        exerciseNameSnapshot: 'ベンチプレス',
        note: '肩甲骨を寄せる',
        startedAt: sourceTime,
        completedAt: sourceTime,
        createdAt: sourceTime,
        updatedAt: sourceTime,
        sets: [
          {
            id: 'source-bench-set-2',
            position: 1,
            status: 'completed',
            setType: 'working',
            targetLoadGrams: 82_500,
            targetRepMin: 8,
            targetRepMax: 10,
            actualLoadGrams: 80_000,
            actualReps: 9,
            memo: '前回セットメモ',
            completedAt: sourceTime,
            createdAt: sourceTime,
            updatedAt: sourceTime,
          },
          {
            id: 'source-bench-set-1',
            position: 0,
            status: 'completed',
            setType: 'working',
            targetLoadGrams: 80_000,
            targetRepMin: 10,
            targetRepMax: 10,
            actualLoadGrams: 77_500,
            actualReps: 10,
            memo: '',
            completedAt: sourceTime,
            createdAt: sourceTime,
            updatedAt: sourceTime,
          },
        ],
      },
    ],
  };
}

async function resetDatabase() {
  await closeLocalDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DRAFT_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('テストDBを削除できません'));
  });
}

beforeEach(resetDatabase);

describe('Phase 1B-2b workout copy', () => {
  it('新しいIDと元の順序で未実施ワークアウトを作り、元データを変更しない', () => {
    const source = sourceWorkout();
    const original = structuredClone(source);
    let sequence = 0;
    const copied = copyWorkoutForToday(source, {
      timestamp: copiedTime,
      localDate: '2026-09-04',
      timezone: 'Asia/Tokyo',
      idFactory: () => `new-id-${sequence++}`,
    });

    expect(source).toEqual(original);
    expect(copied.id).not.toBe(source.id);
    expect(copied.sourceWorkoutId).toBe(source.id);
    expect(copied.exercises.map((item) => item.exerciseId)).toEqual([
      'ex-bench-press',
      'ex-seated-row',
    ]);
    expect(copied.exercises.map((item) => item.id)).not.toContain(
      source.exercises[0].id,
    );
    expect(copied.exercises[0].sets.map((item) => item.position)).toEqual([
      0, 1,
    ]);
    expect(copied.exercises[0].sets.map((item) => item.id)).not.toContain(
      'source-bench-set-1',
    );
    expect(
      copied.exercises.every((item) => item.status === 'in_progress'),
    ).toBe(true);
    expect(
      copied.exercises
        .flatMap((item) => item.sets)
        .every(
          (set) =>
            set.status === 'planned' &&
            set.actualLoadGrams === null &&
            set.actualReps === null &&
            set.completedAt === null &&
            set.memo === '',
        ),
    ).toBe(true);
    expect(copied.overallNote).toBe('');
    expect(copied.rating).toBeNull();
  });

  it('既存targetを優先し、target未設定時だけactualを初期targetにする', () => {
    const copied = copyWorkoutForToday(sourceWorkout(), {
      timestamp: copiedTime,
      localDate: '2026-09-04',
      idFactory: () => crypto.randomUUID(),
    });
    expect(copied.exercises[0].sets[0]).toMatchObject({
      targetLoadGrams: 80_000,
      targetRepMin: 10,
      targetRepMax: 10,
      actualLoadGrams: null,
      actualReps: null,
    });
    expect(copied.exercises[1].sets[0]).toMatchObject({
      targetLoadGrams: 55_000,
      targetRepMin: 11,
      targetRepMax: 11,
      actualLoadGrams: null,
      actualReps: null,
    });
    expect(copied.exercises.map((item) => item.note)).toEqual([
      '肩甲骨を寄せる',
      '胸を張る',
    ]);
  });

  it('コピー直後からIndexedDBと標準create同期キューへ保存する', async () => {
    const copied = copyWorkoutForToday(sourceWorkout(), {
      timestamp: copiedTime,
      localDate: '2026-09-04',
    });
    const { mutation } = await saveWorkoutDraftAndEnqueueMutation(
      copied,
      'create',
      { localUpdatedAt: copied.updatedAt, serverUpdatedAt: null },
    );

    expect(await getLocalWorkoutDraft(copied.id)).toMatchObject({
      draftStatus: 'active',
      workout: { id: copied.id, sourceWorkoutId: 'source-workout' },
    });
    expect(mutation).toMatchObject({
      entityId: copied.id,
      workoutId: copied.id,
      operation: 'create',
      baseVersion: 0,
      syncStatus: 'pending',
    });
    expect(await listWorkoutMutations(copied.id)).toHaveLength(1);
  });

  it('削除済みまたは未完了のworkoutはコピーしない', () => {
    const deleted = sourceWorkout();
    deleted.deletedAt = copiedTime;
    expect(() => copyWorkoutForToday(deleted)).toThrow('完了済み');
    const active = sourceWorkout();
    active.status = 'active';
    expect(() => copyWorkoutForToday(active)).toThrow('完了済み');
  });
});

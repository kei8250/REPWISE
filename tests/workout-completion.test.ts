import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prepareWorkoutCompletion } from '@/lib/workouts/completion';
import { createLocalWorkout, createSet } from '@/lib/workouts/draft';
import { adjacentMonth, monthBounds } from '@/lib/workouts/history-navigation';
import {
  closeLocalDraftDatabase,
  getLocalWorkoutDraft,
  LOCAL_DRAFT_DATABASE_NAME,
  saveActiveWorkoutDraft,
  saveWorkoutDraftAndEnqueueMutation,
  selectWorkoutForRestore,
  workoutToSummary,
} from '@/lib/workouts/local-drafts';
import { mergeVisibleWorkouts } from '@/lib/workouts/visible-workouts';
import type { Workout } from '@/lib/workouts/types';

const time = '2026-10-14T08:00:00.000Z';
function workout(): Workout {
  return {
    ...createLocalWorkout({
      name: '10月14日のトレーニング',
      localDate: '2026-10-14',
      timezone: 'Asia/Tokyo',
      startedAt: time,
    }),
    id: 'finish-test',
    exercises: [
      {
        id: 'bench',
        exerciseId: 'ex-bench-press',
        position: 0,
        status: 'in_progress',
        exerciseNameSnapshot: 'ベンチプレス',
        note: '肩に注意',
        startedAt: time,
        completedAt: null,
        createdAt: time,
        updatedAt: time,
        sets: [
          {
            ...createSet(0),
            actualLoadGrams: 80000,
            actualReps: 10,
            memo: 'フォームを維持',
          },
          { ...createSet(1), actualLoadGrams: 75000, actualReps: 8 },
          createSet(2),
        ],
      },
    ],
  };
}

beforeEach(async () => {
  await closeLocalDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DRAFT_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('ending a workout', () => {
  it('チェック未操作でも入力済みの各セットを確定し、空セットだけをスキップする', () => {
    const current = workout();
    const result = prepareWorkoutCompletion(current, time);
    expect(result.status).toBe('completed');
    expect(result.exercises[0].status).toBe('completed');
    expect(result.exercises[0].sets.map((set) => set.status)).toEqual([
      'completed',
      'completed',
      'skipped',
    ]);
    expect(result.exercises[0].sets[0]).toMatchObject({
      actualLoadGrams: 80000,
      actualReps: 10,
      memo: 'フォームを維持',
      completedAt: time,
    });
    expect(current.status).toBe('active');
    expect(current.exercises[0].sets[0].status).toBe('planned');
  });
  it('片方しか入力していないセットや不正な回数は、場所を示して終了を止める', () => {
    const current = workout();
    current.exercises[0].sets[1].actualReps = null;
    expect(() => prepareWorkoutCompletion(current)).toThrow(
      'ベンチプレスのセット2',
    );
    current.exercises[0].sets[1].actualReps = 1.5;
    expect(() => prepareWorkoutCompletion(current)).toThrow('整数');
    expect(current.status).toBe('active');
    current.exercises[0].sets[1].actualReps = 8;
    current.exercises[0].sets[1].actualLoadGrams = 2_000_001;
    expect(() => prepareWorkoutCompletion(current)).toThrow('2000kg');
  });
  it('未入力・スキップのみのワークアウトを完了記録として作らない', () => {
    const current = workout();
    current.exercises[0].sets = [createSet(0)];
    expect(() => prepareWorkoutCompletion(current)).toThrow('1つ以上');
    expect(() =>
      prepareWorkoutCompletion({ ...current, exercises: [] }),
    ).toThrow('種目');
  });
  it('0kgの自重記録を完了でき、明示したスキップは維持する', () => {
    const current = workout();
    current.exercises[0].sets[0].actualLoadGrams = 0;
    current.exercises[0].sets[1].status = 'skipped';
    const result = prepareWorkoutCompletion(current, time);
    expect(result.exercises[0].sets[0]).toMatchObject({
      status: 'completed',
      actualLoadGrams: 0,
    });
    expect(result.exercises[0].sets[1].status).toBe('skipped');
  });
  it('終了後の古いactive保存・別タブのreplaceで終了状態を巻き戻さない', async () => {
    const current = workout();
    const completed = prepareWorkoutCompletion(current, time);
    await saveWorkoutDraftAndEnqueueMutation(completed, 'complete', {
      serverUpdatedAt: null,
    });
    await saveActiveWorkoutDraft(current, {
      localUpdatedAt: '2026-10-14T09:00:00.000Z',
    });
    expect((await getLocalWorkoutDraft(current.id))?.draftStatus).toBe(
      'completed',
    );
    await expect(
      saveWorkoutDraftAndEnqueueMutation(current, 'replace'),
    ).rejects.toThrow('終了済み');
    expect((await getLocalWorkoutDraft(current.id))?.workout.status).toBe(
      'completed',
    );
  });
  it('未同期完了とACK済み完了を、古いサーバーactiveから復元・表示しない', async () => {
    const current = workout();
    const completed = prepareWorkoutCompletion(current, time);
    await saveWorkoutDraftAndEnqueueMutation(completed, 'complete');
    const stored = await getLocalWorkoutDraft(current.id);
    expect(selectWorkoutForRestore(current, stored, true).workout?.status).toBe(
      'completed',
    );
    expect(
      mergeVisibleWorkouts(
        [workoutToSummary(current)],
        [stored!],
        [],
        'active',
      ),
    ).toEqual([]);
    expect(
      selectWorkoutForRestore(
        current,
        { ...stored!, serverVersion: 3, workout: { ...completed, version: 3 } },
        false,
      ).workout?.status,
    ).toBe('completed');
    expect(
      selectWorkoutForRestore(
        null,
        { ...stored!, serverUpdatedAt: time },
        false,
      ).workout,
    ).toBeNull();
  });
});

describe('history period navigation', () => {
  it('月末・閏年・年跨ぎの絞り込み範囲が正しい', () => {
    expect(monthBounds('2026-02')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(monthBounds('2028-02').to).toBe('2028-02-29');
    expect(adjacentMonth('2026-01', -1)).toBe('2025-12');
    expect(adjacentMonth('2026-12', 1)).toBe('2027-01');
    expect(() => monthBounds('2026-13')).toThrow();
  });
});

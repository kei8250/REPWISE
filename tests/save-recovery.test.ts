import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalWorkout } from '@/lib/workouts/draft';
import { listWorkouts } from '@/lib/workouts/api-client';
import {
  closeLocalDraftDatabase,
  LOCAL_DRAFT_DATABASE_NAME,
  readLocalWorkoutSources,
  saveWorkoutDraftAndEnqueueMutation,
  type LocalWorkoutDraft,
} from '@/lib/workouts/local-drafts';
import {
  mergeVisibleWorkouts,
  loadVisibleWorkouts,
} from '@/lib/workouts/visible-workouts';
import {
  getSyncIdleMs,
  nextAutomaticSyncDelay,
  noteWorkoutEdit,
  setSyncIdleMs,
} from '@/lib/workouts/sync-timing';
import { syncPendingWorkoutMutations } from '@/lib/workouts/sync-queue';
import {
  validateExerciseMasterUpdate,
  WorkoutValidationError,
} from '@/lib/workouts/validation';
import type { Workout, WorkoutMutation } from '@/lib/workouts/types';

vi.mock('@/lib/workouts/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/workouts/api-client')>()),
  listWorkouts: vi.fn(),
}));
const list = vi.mocked(listWorkouts);
const startedAt = '2026-10-14T08:00:00.000Z';
const completed = (): Workout => ({
  ...createLocalWorkout({
    name: '10月14日のトレーニング',
    localDate: '2026-10-14',
    timezone: 'Asia/Tokyo',
    startedAt,
  }),
  id: 'local-workout',
  status: 'completed',
  endedAt: startedAt,
  overallNote: '入力したメモ',
});
const draft = (
  workout = completed(),
  serverUpdatedAt: string | null = null,
): LocalWorkoutDraft => ({
  workoutId: workout.id,
  schemaVersion: 1,
  draftStatus: workout.deletedAt ? 'deleted' : 'completed',
  workout,
  serverUpdatedAt,
  serverVersion: 1,
  localUpdatedAt: startedAt,
  completedAt: startedAt,
});
const mutation = (patch: Partial<WorkoutMutation> = {}): WorkoutMutation => ({
  mutationId: 'm1',
  entityType: 'workout',
  entityId: 'local-workout',
  workoutId: 'local-workout',
  operation: 'complete',
  baseVersion: 1,
  payload: { workout: completed() },
  createdAt: startedAt,
  sequence: 1,
  retryCount: 0,
  syncStatus: 'pending',
  lastAttemptAt: null,
  lastError: null,
  ...patch,
});

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await closeLocalDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase(LOCAL_DRAFT_DATABASE_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});

describe('saved record visibility', () => {
  it('完了して未同期の記録は空のサーバー履歴にも表示する', () => {
    const items = mergeVisibleWorkouts(
      [],
      [draft()],
      [mutation()],
      'completed',
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'local-workout',
      localOnly: true,
      pendingSync: true,
    });
  });
  it('端末で完了した記録を古いactive一覧から除外する', () => {
    const server = [
      {
        id: 'local-workout',
        name: 'old',
        status: 'active' as const,
        localDate: '2026-10-14',
        startedAt,
        endedAt: null,
        exerciseCount: 0,
        setCount: 0,
        completedSetCount: 0,
        totalVolumeGrams: 0,
      },
    ];
    expect(
      mergeVisibleWorkouts(server, [draft()], [mutation()], 'active'),
    ).toEqual([]);
  });
  it('削除と日付のフィルターを尊重し、同期済みの古いキャッシュを復活させない', () => {
    expect(
      mergeVisibleWorkouts(
        [],
        [draft(completed(), startedAt)],
        [],
        'completed',
      ),
    ).toEqual([]);
    expect(
      mergeVisibleWorkouts(
        [],
        [draft({ ...completed(), deletedAt: startedAt })],
        [mutation()],
        'completed',
      ),
    ).toEqual([]);
    expect(
      mergeVisibleWorkouts([], [draft()], [mutation()], 'completed', {
        from: '2026-10-15',
      }),
    ).toEqual([]);
  });
  it('通信失敗中もIndexedDBから完了記録を一覧へ復元できる', async () => {
    await saveWorkoutDraftAndEnqueueMutation(completed(), 'complete', {
      serverUpdatedAt: null,
    });
    list.mockRejectedValueOnce(new Error('通信失敗'));
    const page = await loadVisibleWorkouts('completed');
    expect(page.serverAvailable).toBe(false);
    expect(page.items[0].name).toBe(completed().name);
    await closeLocalDraftDatabase();
    expect(
      (await readLocalWorkoutSources()).drafts[0].workout.overallNote,
    ).toBe('入力したメモ');
  });
  it('GET中にACKされてもサーバーの古い空一覧で記録が消えない', async () => {
    await saveWorkoutDraftAndEnqueueMutation(completed(), 'complete', {
      serverUpdatedAt: null,
    });
    list.mockImplementationOnce(async () => {
      await syncPendingWorkoutMutations('local-workout', {
        fetcher: async (_url, init) => {
          const body = init?.body;
          if (typeof body !== 'string') throw new Error('Expected JSON body');
          const m = JSON.parse(body);
          return Response.json({
            mutationId: m.mutationId,
            duplicate: false,
            workout: { ...completed(), version: 2 },
          });
        },
      });
      return [];
    });
    expect((await loadVisibleWorkouts('completed')).items).toHaveLength(1);
    expect((await readLocalWorkoutSources()).mutations).toHaveLength(0);
  });
});

describe('sync timing', () => {
  it('入力のたびに3秒の待機を延長し、待機中に送信しない', () => {
    noteWorkoutEdit('typing', 1000);
    expect(nextAutomaticSyncDelay('typing', [mutation()], 1200)).toBe(2800);
    noteWorkoutEdit('typing', 2000);
    expect(nextAutomaticSyncDelay('typing', [mutation()], 2500)).toBe(2500);
    expect(nextAutomaticSyncDelay('typing', [mutation()], 5000)).toBe(0);
  });
  it('失敗した先頭はbackoffし、blockedと競合を自動で再試行しない', () => {
    const failed = mutation({
      syncStatus: 'failed',
      retryCount: 1,
      lastAttemptAt: startedAt,
    });
    expect(
      nextAutomaticSyncDelay('failure', [failed], Date.parse(startedAt) + 1000),
    ).toBe(29000);
    expect(
      nextAutomaticSyncDelay(
        'failure',
        [{ ...failed, retryCount: 4 }],
        Date.parse(startedAt) + 1000,
      ),
    ).toBe(239000);
    expect(
      nextAutomaticSyncDelay('failure', [mutation({ syncStatus: 'blocked' })]),
    ).toBeNull();
    expect(
      nextAutomaticSyncDelay('failure', [mutation({ syncStatus: 'conflict' })]),
    ).toBeNull();
  });
  it('設定した10秒の待機を保存し、許可していない値を拒否する', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k),
        setItem: (k: string, v: string) => store.set(k, v),
      },
      dispatchEvent: vi.fn(),
    });
    setSyncIdleMs(10000);
    expect(getSyncIdleMs()).toBe(10000);
    expect(() => setSyncIdleMs(1)).toThrow();
    vi.unstubAllGlobals();
  });
});

describe('exercise settings validation', () => {
  const input = {
    name: ' ベンチプレス ',
    bodyPart: '胸',
    defaultRepMin: 8,
    defaultRepMax: 12,
    defaultWorkingSets: 3,
    defaultIncrementGrams: 2500,
    defaultRestSeconds: 90,
  };
  it('名前を正規化し、初期値を検証する', () =>
    expect(validateExerciseMasterUpdate(input)).toMatchObject({
      name: 'ベンチプレス',
      defaultWorkingSets: 3,
    }));
  it('セット数・rep範囲・部位の不正値を拒否する', () => {
    expect(() =>
      validateExerciseMasterUpdate({ ...input, defaultWorkingSets: 0 }),
    ).toThrow(WorkoutValidationError);
    expect(() =>
      validateExerciseMasterUpdate({ ...input, defaultRepMin: 13 }),
    ).toThrow(WorkoutValidationError);
    expect(() =>
      validateExerciseMasterUpdate({ ...input, bodyPart: '不明' }),
    ).toThrow(WorkoutValidationError);
  });
});

it('入力エラーをHTTP番号・項目名付きで保持して同期を停止する', async () => {
  const active = { ...completed(), status: 'active' as const, endedAt: null };
  await saveWorkoutDraftAndEnqueueMutation(active, 'create', {
    serverUpdatedAt: null,
  });
  const result = await syncPendingWorkoutMutations(active.id, {
    fetcher: async () =>
      Response.json(
        {
          error: '入力内容を確認してください',
          issues: [
            {
              path: 'payload.workout.exercises.0.sets.0.actualReps',
              message: '整数で入力してください',
            },
          ],
        },
        { status: 400 },
      ),
  });
  expect(result.failed).toMatchObject({ syncStatus: 'blocked' });
  expect(result.failed?.lastError).toContain('HTTP 400');
  expect(result.failed?.lastError).toContain('actualReps');
  expect((await readLocalWorkoutSources()).drafts[0].workout).toMatchObject({
    id: active.id,
  });
});

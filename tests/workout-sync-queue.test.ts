import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeLocalDraftDatabase,
  getLocalWorkoutDraft,
  listWorkoutMutations,
  LOCAL_DRAFT_DATABASE_NAME,
  saveActiveWorkoutDraft,
  saveWorkoutDraftAndEnqueueMutation,
} from '@/lib/workouts/local-drafts';
import {
  getWorkoutQueueState,
  queueStateToSaveState,
  syncPendingWorkoutMutations,
} from '@/lib/workouts/sync-queue';
import type { Workout, WorkoutMutationInput } from '@/lib/workouts/types';

const timestamp = '2026-09-02T10:00:00.000Z';

function workout(): Workout {
  return {
    id: 'offline-workout',
    name: 'オフラインテスト',
    status: 'active',
    localDate: '2026-09-02',
    timezone: 'Asia/Tokyo',
    startedAt: timestamp,
    endedAt: null,
    overallNote: 'IndexedDBには残る',
    rating: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    sourceWorkoutId: null,
    exercises: [],
  };
}

function exercise(id: string, position: number): Workout['exercises'][number] {
  return {
    id,
    exerciseId: `master-${id}`,
    position,
    status: 'in_progress',
    exerciseNameSnapshot: `高速入力種目${position + 1}`,
    note: '',
    startedAt: timestamp,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    sets: [
      {
        id: `${id}-set-1`,
        position: 0,
        status: 'planned',
        setType: 'working',
        targetLoadGrams: null,
        targetRepMin: null,
        targetRepMax: null,
        actualLoadGrams: null,
        actualReps: null,
        memo: '',
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

async function deleteDatabase() {
  await closeLocalDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DRAFT_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

beforeEach(deleteDatabase);

describe('Phase 1B-1b retry queue', () => {
  it('APIが失敗しても下書きと未同期mutationを残す', async () => {
    const local = workout();
    await saveWorkoutDraftAndEnqueueMutation(local, 'create');
    const fetcher = vi.fn(async () =>
      Response.json({ error: '一時的な障害' }, { status: 503 }),
    );

    const result = await syncPendingWorkoutMutations(local.id, { fetcher });
    const queue = await listWorkoutMutations(local.id);
    expect(result.processed).toBe(0);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ syncStatus: 'failed', retryCount: 1 });
    expect(
      queueStateToSaveState(await getWorkoutQueueState(local.id), false),
    ).toBe('error');
    expect(
      queueStateToSaveState(await getWorkoutQueueState(local.id), true),
    ).toBe('pending');
    expect(await getLocalWorkoutDraft(local.id)).not.toBeNull();
  });

  it('オンライン相当の再試行でFIFO同期し、成功済みmutationを再送しない', async () => {
    const local = workout();
    await saveWorkoutDraftAndEnqueueMutation(local, 'create');
    local.overallNote = '2つ目のmutation';
    local.updatedAt = '2026-09-02T10:01:00.000Z';
    await saveWorkoutDraftAndEnqueueMutation(local, 'replace');
    const operations: string[] = [];
    let firstAttempt = true;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== 'string')
          throw new Error('JSON bodyが必要です');
        const mutation = JSON.parse(init.body) as WorkoutMutationInput;
        operations.push(mutation.operation);
        if (firstAttempt) {
          firstAttempt = false;
          return Response.json(
            { error: 'network unavailable' },
            { status: 503 },
          );
        }
        return Response.json({
          mutationId: mutation.mutationId,
          duplicate: false,
          workout: mutation.payload.workout,
        });
      },
    );

    await syncPendingWorkoutMutations(local.id, { fetcher });
    expect((await listWorkoutMutations(local.id))[0].syncStatus).toBe('failed');
    const retried = await syncPendingWorkoutMutations(local.id, { fetcher });
    expect(retried.processed).toBe(2);
    expect(await listWorkoutMutations(local.id)).toEqual([]);
    await syncPendingWorkoutMutations(local.id, { fetcher });
    expect(operations).toEqual(['create', 'create', 'replace']);
  });

  it('claim中のreplaceを保持し、後続replaceを次versionで続けてdrainする', async () => {
    const local = workout();
    await saveWorkoutDraftAndEnqueueMutation(local, 'create');
    let serverVersion = 0;
    const initialFetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== 'string')
          throw new Error('JSON bodyが必要です');
        const input = JSON.parse(init.body) as WorkoutMutationInput;
        expect(input.baseVersion).toBe(serverVersion);
        serverVersion += 1;
        return Response.json({
          mutationId: input.mutationId,
          duplicate: false,
          workout: { ...input.payload.workout, version: serverVersion },
        });
      },
    );
    await syncPendingWorkoutMutations(local.id, { fetcher: initialFetcher });

    local.exercises = [exercise('exercise-1', 0)];
    await saveWorkoutDraftAndEnqueueMutation(local, 'replace');
    let releaseFirstReplace!: () => void;
    const firstReplaceGate = new Promise<void>((resolve) => {
      releaseFirstReplace = resolve;
    });
    let reportFirstReplaceClaimed!: () => void;
    const firstReplaceClaimed = new Promise<void>((resolve) => {
      reportFirstReplaceClaimed = resolve;
    });
    const sentBaseVersions: number[] = [];
    let replaceRequests = 0;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== 'string')
          throw new Error('JSON bodyが必要です');
        const input = JSON.parse(init.body) as WorkoutMutationInput;
        sentBaseVersions.push(input.baseVersion);
        replaceRequests += 1;
        if (replaceRequests === 1) {
          reportFirstReplaceClaimed();
          await firstReplaceGate;
        }
        if (input.baseVersion !== serverVersion) {
          return Response.json(
            {
              error: '別の変更が存在します',
              code: 'WORKOUT_VERSION_CONFLICT',
              conflict: {
                type: 'stale',
                baseVersion: input.baseVersion,
                serverVersion,
                serverUpdatedAt: timestamp,
              },
            },
            { status: 409 },
          );
        }
        serverVersion += 1;
        return Response.json({
          mutationId: input.mutationId,
          duplicate: false,
          workout: { ...input.payload.workout, version: serverVersion },
        });
      },
    );

    const syncing = syncPendingWorkoutMutations(local.id, { fetcher });
    await firstReplaceClaimed;
    expect((await listWorkoutMutations(local.id))[0]).toMatchObject({
      syncStatus: 'syncing',
      baseVersion: 1,
    });
    local.exercises.push(exercise('exercise-2', 1));
    await saveWorkoutDraftAndEnqueueMutation(local, 'replace');
    expect(
      (await listWorkoutMutations(local.id)).map((item) => item.baseVersion),
    ).toEqual([1, 2]);

    releaseFirstReplace();
    const result = await syncing;
    expect(result).toMatchObject({ processed: 2, remaining: 0, failed: null });
    expect(sentBaseVersions).toEqual([1, 2]);
    expect(serverVersion).toBe(3);
  });

  it('高速な種目追加・重量・rep変更を25回繰り返しても競合しない', async () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await deleteDatabase();
      const local = workout();
      local.id = `rapid-workout-${attempt}`;
      await saveWorkoutDraftAndEnqueueMutation(local, 'create');
      let serverVersion = 0;
      let releaseFirstReplace!: () => void;
      const firstReplaceGate = new Promise<void>((resolve) => {
        releaseFirstReplace = resolve;
      });
      let reportFirstReplaceClaimed!: () => void;
      const firstReplaceClaimed = new Promise<void>((resolve) => {
        reportFirstReplaceClaimed = resolve;
      });
      let replaceRequests = 0;
      const sentBaseVersions: number[] = [];
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (typeof init?.body !== 'string')
            throw new Error('JSON bodyが必要です');
          const input = JSON.parse(init.body) as WorkoutMutationInput;
          sentBaseVersions.push(input.baseVersion);
          if (input.operation === 'replace') {
            replaceRequests += 1;
            if (replaceRequests === 1) {
              reportFirstReplaceClaimed();
              await firstReplaceGate;
            }
          }
          if (input.baseVersion !== serverVersion) {
            return Response.json(
              {
                error: '別の変更が存在します',
                code: 'WORKOUT_VERSION_CONFLICT',
                conflict: {
                  type: 'stale',
                  baseVersion: input.baseVersion,
                  serverVersion,
                  serverUpdatedAt: timestamp,
                },
              },
              { status: 409 },
            );
          }
          serverVersion += 1;
          return Response.json({
            mutationId: input.mutationId,
            duplicate: false,
            workout: { ...input.payload.workout, version: serverVersion },
          });
        },
      );

      await syncPendingWorkoutMutations(local.id, { fetcher });
      local.exercises = [exercise(`exercise-${attempt}-1`, 0)];
      await saveWorkoutDraftAndEnqueueMutation(local, 'replace');
      const syncing = syncPendingWorkoutMutations(local.id, { fetcher });
      await firstReplaceClaimed;

      local.exercises.push(exercise(`exercise-${attempt}-2`, 1));
      await saveWorkoutDraftAndEnqueueMutation(local, 'replace');
      local.exercises.push(exercise(`exercise-${attempt}-3`, 2));
      await saveWorkoutDraftAndEnqueueMutation(local, 'replace');
      local.exercises[0].sets[0].actualLoadGrams = 80_000;
      local.exercises[0].sets[0].actualReps = 8;
      local.exercises[0].sets[0].status = 'completed';
      await saveWorkoutDraftAndEnqueueMutation(local, 'replace');

      releaseFirstReplace();
      const result = await syncing;
      expect(result.failed).toBeNull();
      expect(await listWorkoutMutations(local.id)).toEqual([]);
      expect(sentBaseVersions).toEqual([0, 1, 2]);
      expect(serverVersion).toBe(3);
      const saved = await getLocalWorkoutDraft(local.id);
      expect(saved?.workout.exercises).toHaveLength(3);
      expect(saved?.workout.exercises[0].sets[0]).toMatchObject({
        actualLoadGrams: 80_000,
        actualReps: 8,
        status: 'completed',
      });
    }
  });

  it('同一ミリ秒の連続入力でも先行ackで新しいローカル下書きを巻き戻さない', async () => {
    const local = workout();
    await saveWorkoutDraftAndEnqueueMutation(local, 'create', {
      localUpdatedAt: timestamp,
    });
    local.overallNote = '同じ時刻でも後から入力';
    await saveWorkoutDraftAndEnqueueMutation(local, 'replace', {
      localUpdatedAt: timestamp,
    });
    let calls = 0;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== 'string')
          throw new Error('JSON bodyが必要です');
        const input = JSON.parse(init.body) as WorkoutMutationInput;
        calls += 1;
        if (calls === 2) {
          return Response.json({ error: '一時停止' }, { status: 503 });
        }
        return Response.json({
          mutationId: input.mutationId,
          duplicate: false,
          workout: input.payload.workout,
        });
      },
    );

    await syncPendingWorkoutMutations(local.id, { fetcher });
    expect((await getLocalWorkoutDraft(local.id))?.workout.overallNote).toBe(
      '同じ時刻でも後から入力',
    );
    expect(await listWorkoutMutations(local.id)).toHaveLength(1);
  });

  it('恒久的な入力エラーはblockedにして自動で無限再試行しない', async () => {
    const local = workout();
    await saveWorkoutDraftAndEnqueueMutation(local, 'create');
    const fetcher = vi.fn(async () =>
      Response.json({ error: '入力が不正です' }, { status: 400 }),
    );
    await syncPendingWorkoutMutations(local.id, { fetcher });
    await syncPendingWorkoutMutations(local.id, { fetcher });

    expect(fetcher).toHaveBeenCalledOnce();
    expect((await listWorkoutMutations(local.id))[0]).toMatchObject({
      syncStatus: 'blocked',
      retryCount: 1,
    });
  });

  it('version競合ではローカルとmutationを保持して自動・手動再送を停止する', async () => {
    const local = workout();
    local.version = 5;
    local.overallNote = '失ってはいけないローカル記録';
    await saveActiveWorkoutDraft(local, {
      serverUpdatedAt: local.updatedAt,
    });
    await saveWorkoutDraftAndEnqueueMutation(local, 'replace');
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: '別の変更が存在します',
          code: 'WORKOUT_VERSION_CONFLICT',
          conflict: {
            type: 'stale',
            baseVersion: 5,
            serverVersion: 6,
            serverUpdatedAt: '2026-09-02T10:01:00.000Z',
          },
        },
        { status: 409 },
      ),
    );

    await syncPendingWorkoutMutations(local.id, { fetcher });
    await syncPendingWorkoutMutations(local.id, { fetcher });
    await syncPendingWorkoutMutations(local.id, { fetcher, manual: true });

    expect(fetcher).toHaveBeenCalledOnce();
    expect((await listWorkoutMutations(local.id))[0]).toMatchObject({
      syncStatus: 'conflict',
      baseVersion: 5,
      retryCount: 1,
    });
    expect(
      queueStateToSaveState(await getWorkoutQueueState(local.id), false),
    ).toBe('conflict');
    expect((await getLocalWorkoutDraft(local.id))?.workout.overallNote).toBe(
      '失ってはいけないローカル記録',
    );
  });

  it('完了済み編集の競合でもローカル編集を保持して自動再送を停止する', async () => {
    const local = workout();
    local.status = 'completed';
    local.endedAt = timestamp;
    local.version = 5;
    local.overallNote = '保持する完了済み編集';
    await saveWorkoutDraftAndEnqueueMutation(local, 'edit');
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: '別の変更が存在します',
          code: 'WORKOUT_VERSION_CONFLICT',
          conflict: {
            type: 'stale',
            baseVersion: 5,
            serverVersion: 6,
            serverUpdatedAt: timestamp,
          },
        },
        { status: 409 },
      ),
    );

    await syncPendingWorkoutMutations(local.id, { fetcher });
    await syncPendingWorkoutMutations(local.id, { fetcher });

    expect(fetcher).toHaveBeenCalledOnce();
    expect((await listWorkoutMutations(local.id))[0]).toMatchObject({
      operation: 'edit',
      syncStatus: 'conflict',
      baseVersion: 5,
    });
    expect(await getLocalWorkoutDraft(local.id)).toMatchObject({
      draftStatus: 'completed_edit',
      workout: { overallNote: '保持する完了済み編集' },
    });
  });

  it('soft deleteとrestoreの成功ackでローカル状態とversionを更新する', async () => {
    const local = workout();
    local.status = 'completed';
    local.endedAt = timestamp;
    local.version = 2;
    local.deletedAt = timestamp;
    await saveWorkoutDraftAndEnqueueMutation(local, 'delete');
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== 'string')
          throw new Error('JSON bodyが必要です');
        const input = JSON.parse(init.body) as WorkoutMutationInput;
        return Response.json({
          mutationId: input.mutationId,
          duplicate: false,
          workout: {
            ...input.payload.workout,
            version: input.baseVersion + 1,
          },
        });
      },
    );

    await syncPendingWorkoutMutations(local.id, { fetcher });
    expect(await getLocalWorkoutDraft(local.id)).toMatchObject({
      draftStatus: 'deleted',
      serverVersion: 3,
      workout: { deletedAt: timestamp },
    });

    local.deletedAt = null;
    local.version = 2;
    await saveWorkoutDraftAndEnqueueMutation(local, 'restore');
    expect((await listWorkoutMutations(local.id))[0].baseVersion).toBe(3);
    await syncPendingWorkoutMutations(local.id, { fetcher });
    expect(await getLocalWorkoutDraft(local.id)).toMatchObject({
      draftStatus: 'completed',
      serverVersion: 4,
      workout: { deletedAt: null },
    });
  });
});

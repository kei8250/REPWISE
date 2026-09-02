import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeLocalDraftDatabase,
  getLocalWorkoutDraft,
  listWorkoutMutations,
  LOCAL_DRAFT_DATABASE_NAME,
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
    exercises: [],
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
});

import { describe, expect, it, vi } from 'vitest';
import {
  loadActiveWorkoutSourcesLocalFirst,
  shouldAdoptServerWorkout,
  shouldUpgradeLocalDraftToQueue,
} from '@/lib/workouts/active-workout-loader';
import type { LocalWorkoutDraft } from '@/lib/workouts/local-drafts';
import type { Workout, WorkoutMutation } from '@/lib/workouts/types';

const timestamp = '2026-09-10T10:00:00.000Z';

function workout(version = 4): Workout {
  return {
    id: 'local-first-workout',
    name: 'ローカル先行表示テスト',
    status: 'active',
    localDate: '2026-09-10',
    timezone: 'Asia/Tokyo',
    startedAt: timestamp,
    endedAt: null,
    overallNote: 'ローカル入力',
    rating: null,
    version,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    sourceWorkoutId: null,
    exercises: [],
  };
}

function draft(options: Partial<LocalWorkoutDraft> = {}): LocalWorkoutDraft {
  const value = workout();
  return {
    workoutId: value.id,
    schemaVersion: 1,
    draftStatus: 'active',
    workout: value,
    localUpdatedAt: timestamp,
    serverUpdatedAt: timestamp,
    serverVersion: value.version,
    completedAt: null,
    ...options,
  };
}

function mutation(): WorkoutMutation {
  const value = workout();
  return {
    mutationId: 'mutation-1',
    entityType: 'workout',
    entityId: value.id,
    workoutId: value.id,
    operation: 'replace',
    baseVersion: value.version,
    payload: { workout: value },
    createdAt: timestamp,
    sequence: 1,
    retryCount: 0,
    syncStatus: 'pending',
    lastAttemptAt: null,
    lastError: null,
  };
}

describe('Perf-A2a Active Workout local-first loader', () => {
  it('遅いserver応答を待たずにlocal draftを表示可能にする', async () => {
    let resolveServer!: (value: Workout) => void;
    const server = new Promise<Workout>((resolve) => {
      resolveServer = resolve;
    });
    const onLocalReady = vi.fn();
    let completed = false;
    const loading = loadActiveWorkoutSourcesLocalFirst({
      workoutId: workout().id,
      loadLocal: async () => draft(),
      loadServer: () => server,
      loadQueue: async () => [],
      onLocalReady,
    }).then((result) => {
      completed = true;
      return result;
    });

    await vi.waitFor(() => expect(onLocalReady).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    expect(onLocalReady.mock.calls[0][0].workout.overallNote).toBe(
      'ローカル入力',
    );

    resolveServer(workout());
    await loading;
    expect(completed).toBe(true);
  });

  it('offline相当でserverが失敗してもlocal draftを先に返す', async () => {
    const onLocalReady = vi.fn();
    const onQueueReady = vi.fn();
    const result = await loadActiveWorkoutSourcesLocalFirst({
      workoutId: workout().id,
      loadLocal: async () => draft(),
      loadServer: async () => {
        throw new Error('offline');
      },
      loadQueue: async () => [mutation()],
      onLocalReady,
      onQueueReady,
    });

    expect(onLocalReady).toHaveBeenCalledOnce();
    expect(onQueueReady).toHaveBeenCalledWith([
      expect.objectContaining({ mutationId: 'mutation-1' }),
    ]);
    expect(result.server.status).toBe('rejected');
    expect(result.queue).toMatchObject({
      status: 'fulfilled',
      value: [{ mutationId: 'mutation-1' }],
    });
  });

  it('同一versionのserver snapshotへ表示を切り替えない', () => {
    const local = draft();
    const server = workout();
    server.overallNote = '同一versionの古い取得結果';
    expect(
      shouldAdoptServerWorkout({
        serverWorkout: server,
        currentWorkout: local.workout,
        localDraft: local,
        localWasDisplayed: true,
        queuedMutationCount: 0,
        initializationRevision: 0,
        currentRevision: 0,
      }),
    ).toBe(false);
  });

  it('未同期queueまたは表示後の入力がある間はserverで巻き戻さない', () => {
    const local = draft();
    const newerServer = workout(5);
    for (const values of [
      { queuedMutationCount: 1, currentRevision: 0 },
      { queuedMutationCount: 0, currentRevision: 1 },
    ]) {
      expect(
        shouldAdoptServerWorkout({
          serverWorkout: newerServer,
          currentWorkout: local.workout,
          localDraft: local,
          localWasDisplayed: true,
          initializationRevision: 0,
          ...values,
        }),
      ).toBe(false);
    }
  });

  it('未同期変更がなければ新しいserver versionを採用し、古いversionは拒否する', () => {
    const local = draft();
    const common = {
      currentWorkout: local.workout,
      localDraft: local,
      localWasDisplayed: true,
      queuedMutationCount: 0,
      initializationRevision: 0,
      currentRevision: 0,
    };
    expect(
      shouldAdoptServerWorkout({ ...common, serverWorkout: workout(5) }),
    ).toBe(true);
    expect(
      shouldAdoptServerWorkout({ ...common, serverWorkout: workout(3) }),
    ).toBe(false);
  });

  it('同期済みdraftを再送せず、未同期legacy draftだけqueueへ昇格する', () => {
    expect(shouldUpgradeLocalDraftToQueue(draft(), 0)).toBe(false);
    expect(
      shouldUpgradeLocalDraftToQueue(
        draft({ serverVersion: null, serverUpdatedAt: null }),
        0,
      ),
    ).toBe(true);
    expect(
      shouldUpgradeLocalDraftToQueue(
        draft({
          localUpdatedAt: '2026-09-10T10:01:00.000Z',
          serverUpdatedAt: timestamp,
        }),
        0,
      ),
    ).toBe(true);
    expect(
      shouldUpgradeLocalDraftToQueue(
        draft({ serverVersion: null, serverUpdatedAt: null }),
        1,
      ),
    ).toBe(false);
  });
});

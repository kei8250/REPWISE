import { describe, expect, it, vi } from 'vitest';
import {
  loadHomeActiveWorkout,
  loadHomeCompletedWorkout,
} from '@/lib/workouts/home-loader';
import type { LocalWorkoutDraft } from '@/lib/workouts/local-drafts';
import type { Workout, WorkoutSummary } from '@/lib/workouts/types';

const timestamp = '2026-09-10T12:00:00.000Z';

function workout(status: Workout['status'] = 'active'): Workout {
  return {
    id: 'home-local-workout',
    name: 'Home local-first test',
    status,
    localDate: '2026-09-10',
    timezone: 'Asia/Tokyo',
    startedAt: timestamp,
    endedAt: status === 'completed' ? timestamp : null,
    overallNote: 'local home draft',
    rating: null,
    version: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    sourceWorkoutId: null,
    exercises: [],
  };
}

function draft(): LocalWorkoutDraft {
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
  };
}

function summary(id = 'completed-workout'): WorkoutSummary {
  return {
    id,
    name: '前回のワークアウト',
    status: 'completed',
    localDate: '2026-09-09',
    startedAt: timestamp,
    endedAt: timestamp,
    exerciseCount: 3,
    setCount: 9,
    completedSetCount: 9,
    totalVolumeGrams: 1000,
  };
}

describe('Perf-A2b Home section loaders', () => {
  it('local activeをcompleted API完了前に表示する', async () => {
    let resolveCompleted!: (value: WorkoutSummary[]) => void;
    const completed = new Promise<WorkoutSummary[]>((resolve) => {
      resolveCompleted = resolve;
    });
    const onLocalReady = vi.fn();
    let completedSettled = false;
    const completedLoading = loadHomeCompletedWorkout(() => completed).then(
      (state) => {
        completedSettled = true;
        return state;
      },
    );
    const activeLoading = loadHomeActiveWorkout({
      getLocalDraft: async () => draft(),
      listServerActive: async () => [],
      getServerWorkout: async () => workout(),
      listMutations: async () => [],
      onLocalReady,
    });

    await vi.waitFor(() => expect(onLocalReady).toHaveBeenCalledOnce());
    expect(completedSettled).toBe(false);
    expect(onLocalReady.mock.calls[0][0]).toMatchObject({
      id: 'home-local-workout',
      status: 'active',
    });

    resolveCompleted([summary()]);
    await expect(completedLoading).resolves.toMatchObject({
      status: 'success',
    });
    await expect(activeLoading).resolves.toMatchObject({ source: 'local' });
  });

  it('completed取得成功0件をemptyとして返す', async () => {
    await expect(loadHomeCompletedWorkout(async () => [])).resolves.toEqual({
      status: 'empty',
      workout: null,
    });
  });

  it('completed API失敗をemptyへ変換せずerrorとして返す', async () => {
    await expect(
      loadHomeCompletedWorkout(async () => {
        throw new Error('network error');
      }),
    ).resolves.toEqual({ status: 'error', workout: null });
  });

  it('遅いcompleted APIがactive sectionの完了を妨げない', async () => {
    let resolveCompleted!: (value: WorkoutSummary[]) => void;
    const completed = new Promise<WorkoutSummary[]>((resolve) => {
      resolveCompleted = resolve;
    });
    const completedLoading = loadHomeCompletedWorkout(() => completed);
    const active = await loadHomeActiveWorkout({
      getLocalDraft: async () => null,
      listServerActive: async () => [],
      getServerWorkout: async () => workout(),
      listMutations: async () => [],
    });

    expect(active).toEqual({
      workout: null,
      source: 'none',
      serverAvailable: true,
    });
    resolveCompleted([]);
    await expect(completedLoading).resolves.toMatchObject({ status: 'empty' });
  });

  it('local activeを遅いserver応答より先に通知する', async () => {
    let resolveServer!: (value: Workout) => void;
    const server = new Promise<Workout>((resolve) => {
      resolveServer = resolve;
    });
    const onLocalReady = vi.fn();
    let settled = false;
    const loading = loadHomeActiveWorkout({
      getLocalDraft: async () => draft(),
      listServerActive: async () => [],
      getServerWorkout: () => server,
      listMutations: async () => [],
      onLocalReady,
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(onLocalReady).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    resolveServer(workout());
    await expect(loading).resolves.toMatchObject({ source: 'local' });
  });

  it('local activeなしではserver一覧へfallbackする', async () => {
    const serverSummary = {
      ...summary('server-active'),
      status: 'active' as const,
    };
    await expect(
      loadHomeActiveWorkout({
        getLocalDraft: async () => null,
        listServerActive: async () => [serverSummary],
        getServerWorkout: async () => workout(),
        listMutations: async () => [],
      }),
    ).resolves.toEqual({
      workout: serverSummary,
      source: 'server',
      serverAvailable: true,
    });
  });

  it('serverで完了済みと判明したactive draftをHome導線から外す', async () => {
    const completed = workout('completed');
    const onServerCompleted = vi.fn();
    await expect(
      loadHomeActiveWorkout({
        getLocalDraft: async () => draft(),
        listServerActive: async () => [],
        getServerWorkout: async () => completed,
        listMutations: async () => [],
        onServerCompleted,
      }),
    ).resolves.toEqual({
      workout: null,
      source: 'server',
      serverAvailable: true,
    });
    expect(onServerCompleted).toHaveBeenCalledWith(completed);
  });

  it('server/queue確認失敗時はlocal導線を消さない', async () => {
    await expect(
      loadHomeActiveWorkout({
        getLocalDraft: async () => draft(),
        listServerActive: async () => {
          throw new Error('offline');
        },
        getServerWorkout: async () => {
          throw new Error('offline');
        },
        listMutations: async () => {
          throw new Error('IndexedDB busy');
        },
      }),
    ).resolves.toMatchObject({
      workout: { id: 'home-local-workout' },
      source: 'local',
      serverAvailable: false,
    });
  });
});

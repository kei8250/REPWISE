import type { LocalWorkoutDraft } from './local-drafts';
import { selectWorkoutForRestore, workoutToSummary } from './local-drafts';
import type { Workout, WorkoutMutation, WorkoutSummary } from './types';

type Settled<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

export type HomeCompletedState =
  | { status: 'loading'; workout: null }
  | { status: 'empty'; workout: null }
  | { status: 'error'; workout: null }
  | { status: 'success'; workout: WorkoutSummary };

export interface HomeActiveLoadResult {
  workout: WorkoutSummary | null;
  source: 'local' | 'server' | 'none';
  serverAvailable: boolean;
}

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
}

function isUsableHomeActiveDraft(
  draft: LocalWorkoutDraft | null,
): draft is LocalWorkoutDraft {
  return draft?.draftStatus === 'active' && draft.workout.status === 'active';
}

export async function loadHomeActiveWorkout(options: {
  getLocalDraft: () => Promise<LocalWorkoutDraft | null>;
  listServerActive: () => Promise<WorkoutSummary[]>;
  getServerWorkout: (id: string) => Promise<Workout>;
  listMutations: (id: string) => Promise<WorkoutMutation[]>;
  onLocalReady?: (workout: WorkoutSummary) => void;
  onServerCompleted?: (workout: Workout) => Promise<void> | void;
}): Promise<HomeActiveLoadResult> {
  const localPromise = settle(options.getLocalDraft());
  const activePromise = settle(options.listServerActive());
  const localResult = await localPromise;
  const localDraft =
    localResult.status === 'fulfilled' &&
    isUsableHomeActiveDraft(localResult.value)
      ? localResult.value
      : null;

  if (localDraft) {
    options.onLocalReady?.(workoutToSummary(localDraft.workout));

    const [serverWorkoutResult, mutationsResult, activeResult] =
      await Promise.all([
        settle(options.getServerWorkout(localDraft.workoutId)),
        settle(options.listMutations(localDraft.workoutId)),
        activePromise,
      ]);

    // Queue state is part of the restore decision. If it cannot be read, keep
    // the local route and let the Active Workout page perform final recovery.
    if (
      serverWorkoutResult.status === 'rejected' ||
      mutationsResult.status === 'rejected'
    ) {
      return {
        workout: workoutToSummary(localDraft.workout),
        source: 'local',
        serverAvailable: activeResult.status === 'fulfilled',
      };
    }

    const serverWorkout = serverWorkoutResult.value;
    const restored = selectWorkoutForRestore(
      serverWorkout,
      localDraft,
      mutationsResult.value.length > 0,
    );
    if (restored.workout?.status === 'active') {
      return {
        workout: workoutToSummary(restored.workout),
        source: restored.source === 'server' ? 'server' : 'local',
        serverAvailable: true,
      };
    }

    if (serverWorkout.status !== 'active') {
      await options.onServerCompleted?.(serverWorkout);
    }
    return { workout: null, source: 'server', serverAvailable: true };
  }

  const activeResult = await activePromise;
  if (activeResult.status === 'rejected') {
    return { workout: null, source: 'none', serverAvailable: false };
  }
  return {
    workout: activeResult.value[0] ?? null,
    source: activeResult.value.length ? 'server' : 'none',
    serverAvailable: true,
  };
}

export async function loadHomeCompletedWorkout(
  listServerCompleted: () => Promise<WorkoutSummary[]>,
): Promise<HomeCompletedState> {
  try {
    const workouts = await listServerCompleted();
    return workouts.length
      ? { status: 'success', workout: workouts[0] }
      : { status: 'empty', workout: null };
  } catch {
    return { status: 'error', workout: null };
  }
}

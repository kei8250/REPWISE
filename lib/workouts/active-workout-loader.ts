import type { LocalWorkoutDraft } from './local-drafts';
import type { Workout, WorkoutMutation } from './types';

export type ActiveWorkoutLoadResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

export type ActiveWorkoutSources = {
  local: ActiveWorkoutLoadResult<LocalWorkoutDraft | null>;
  server: ActiveWorkoutLoadResult<Workout>;
  queue: ActiveWorkoutLoadResult<WorkoutMutation[]>;
};

function settle<T>(
  load: () => Promise<T>,
): Promise<ActiveWorkoutLoadResult<T>> {
  try {
    return Promise.resolve(load()).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason: unknown) => ({ status: 'rejected', reason }),
    );
  } catch (reason) {
    return Promise.resolve({ status: 'rejected', reason });
  }
}

export function isUsableActiveWorkoutDraft(
  draft: LocalWorkoutDraft | null,
  workoutId: string,
): draft is LocalWorkoutDraft {
  return (
    draft?.workoutId === workoutId &&
    draft.draftStatus === 'active' &&
    draft.workout.status === 'active' &&
    !draft.workout.deletedAt
  );
}

export async function loadActiveWorkoutSourcesLocalFirst(options: {
  workoutId: string;
  loadLocal: () => Promise<LocalWorkoutDraft | null>;
  loadServer: () => Promise<Workout>;
  loadQueue: () => Promise<WorkoutMutation[]>;
  onLocalReady: (draft: LocalWorkoutDraft) => void;
  onQueueReady?: (queue: WorkoutMutation[]) => void;
}): Promise<ActiveWorkoutSources> {
  // Start every source together. Only the local result gates the provisional UI;
  // the network request never sits in front of a usable IndexedDB draft.
  const server = settle(options.loadServer);
  const queue = settle(options.loadQueue);
  const local = settle(options.loadLocal);

  const localResult = await local;
  if (
    localResult.status === 'fulfilled' &&
    isUsableActiveWorkoutDraft(localResult.value, options.workoutId)
  ) {
    options.onLocalReady(localResult.value);
    void queue.then((result) => {
      if (result.status === 'fulfilled') options.onQueueReady?.(result.value);
    });
  }

  const [serverResult, queueResult] = await Promise.all([server, queue]);
  return { local: localResult, server: serverResult, queue: queueResult };
}

export function shouldAdoptServerWorkout(options: {
  serverWorkout: Workout;
  currentWorkout: Workout | null;
  localDraft: LocalWorkoutDraft | null;
  localWasDisplayed: boolean;
  queuedMutationCount: number;
  initializationRevision: number;
  currentRevision: number;
}) {
  if (!options.currentWorkout || !options.localWasDisplayed) return true;
  if (
    options.queuedMutationCount > 0 ||
    options.currentRevision !== options.initializationRevision
  ) {
    return false;
  }

  const recognizedVersion = Math.max(
    options.currentWorkout.version,
    options.localDraft?.serverVersion ?? 0,
  );
  if (options.serverWorkout.version < recognizedVersion) return false;
  if (options.serverWorkout.status !== 'active') return true;

  // The local snapshot is already visible. Equal versions are the same logical
  // revision, so swapping object graphs only creates a needless visual reset.
  return options.serverWorkout.version > recognizedVersion;
}

export function shouldUpgradeLocalDraftToQueue(
  draft: LocalWorkoutDraft | null,
  queuedMutationCount: number,
) {
  if (!draft || queuedMutationCount > 0) return false;
  if (draft.draftStatus !== 'active' || draft.workout.status !== 'active') {
    return false;
  }
  if (draft.serverVersion === null || draft.serverUpdatedAt === null) {
    return true;
  }
  const localUpdatedAt = Date.parse(draft.localUpdatedAt);
  const serverUpdatedAt = Date.parse(draft.serverUpdatedAt);
  return (
    Number.isFinite(localUpdatedAt) &&
    Number.isFinite(serverUpdatedAt) &&
    localUpdatedAt > serverUpdatedAt
  );
}

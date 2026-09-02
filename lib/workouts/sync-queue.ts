import { syncWorkoutMutation, WorkoutApiError } from './api-client';
import {
  acknowledgeWorkoutMutation,
  listWorkoutMutations,
  resetBlockedWorkoutMutations,
  updateWorkoutMutation,
} from './local-drafts';
import type {
  WorkoutMutation,
  WorkoutMutationInput,
  WorkoutMutationSyncStatus,
  SaveState,
} from './types';
import type { FetchLike } from './api-client';

export type WorkoutQueueState = {
  total: number;
  pending: number;
  syncing: number;
  failed: number;
  blocked: number;
  retryCount: number;
  lastError: string | null;
};

export type WorkoutSyncResult = {
  processed: number;
  remaining: number;
  failed: WorkoutMutation | null;
};

const activeSyncs = new Map<string, Promise<WorkoutSyncResult>>();

export function mutationForTransport(
  mutation: WorkoutMutation,
): WorkoutMutationInput {
  return {
    mutationId: mutation.mutationId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    operation: mutation.operation,
    payload: mutation.payload,
    createdAt: mutation.createdAt,
  };
}

export function isPermanentSyncError(error: unknown) {
  return (
    error instanceof WorkoutApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 425, 429].includes(error.status)
  );
}

export function isBrowserOffline() {
  if (typeof navigator === 'undefined') return false;
  if (navigator.onLine === false) return true;
  // Review-only deterministic network interruption for browser E2E. The
  // hostname guard prevents this switch from changing production behavior.
  return (
    typeof window !== 'undefined' &&
    window.location.hostname ===
      'repwise-phase1a-review.keikei8250.chatgpt.site' &&
    new URLSearchParams(window.location.search).has('repwise-offline-test')
  );
}

export function queueStateToSaveState(
  queue: WorkoutQueueState,
  offline = isBrowserOffline(),
): SaveState {
  if (queue.blocked > 0 || (queue.failed > 0 && !offline)) return 'error';
  if (queue.syncing > 0) return 'saving';
  if (queue.total > 0) return offline ? 'pending' : 'saving';
  return 'saved';
}

export async function getWorkoutQueueState(
  workoutId: string,
  databaseName?: string,
): Promise<WorkoutQueueState> {
  const mutations = await listWorkoutMutations(workoutId, databaseName);
  const state: WorkoutQueueState = {
    total: mutations.length,
    pending: 0,
    syncing: 0,
    failed: 0,
    blocked: 0,
    retryCount: 0,
    lastError: null,
  };
  for (const mutation of mutations) {
    state[mutation.syncStatus] += 1;
    state.retryCount = Math.max(state.retryCount, mutation.retryCount);
    if (mutation.lastError) state.lastError = mutation.lastError;
  }
  return state;
}

async function runSync(
  workoutId: string,
  options: {
    fetcher?: FetchLike;
    databaseName?: string;
    manual?: boolean;
  },
): Promise<WorkoutSyncResult> {
  if (isBrowserOffline()) {
    const remaining = await listWorkoutMutations(
      workoutId,
      options.databaseName,
    );
    return { processed: 0, remaining: remaining.length, failed: null };
  }
  if (options.manual) {
    await resetBlockedWorkoutMutations(workoutId, options.databaseName);
  }

  const mutations = await listWorkoutMutations(workoutId, options.databaseName);
  let processed = 0;
  let failed: WorkoutMutation | null = null;
  for (const mutation of mutations) {
    if (mutation.syncStatus === 'blocked' && !options.manual) {
      failed = mutation;
      break;
    }
    const lastAttemptAt = new Date().toISOString();
    await updateWorkoutMutation(
      mutation.mutationId,
      {
        syncStatus: 'syncing',
        retryCount: mutation.retryCount + 1,
        lastAttemptAt,
        lastError: null,
      },
      options.databaseName,
    );
    try {
      const result = await syncWorkoutMutation(
        mutationForTransport(mutation),
        options.fetcher,
      );
      await acknowledgeWorkoutMutation(
        mutation,
        result.workout,
        options.databaseName,
      );
      processed += 1;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : '同期に失敗しました';
      const syncStatus: WorkoutMutationSyncStatus = isPermanentSyncError(cause)
        ? 'blocked'
        : 'failed';
      failed = {
        ...mutation,
        retryCount: mutation.retryCount + 1,
        syncStatus,
        lastAttemptAt,
        lastError: message,
      };
      await updateWorkoutMutation(
        mutation.mutationId,
        {
          syncStatus,
          retryCount: failed.retryCount,
          lastAttemptAt,
          lastError: message,
        },
        options.databaseName,
      );
      // Later snapshots depend on all earlier snapshots having been applied.
      break;
    }
  }
  const remaining = await listWorkoutMutations(workoutId, options.databaseName);
  return { processed, remaining: remaining.length, failed };
}

export function syncPendingWorkoutMutations(
  workoutId: string,
  options: {
    fetcher?: FetchLike;
    databaseName?: string;
    manual?: boolean;
  } = {},
) {
  const key = `${options.databaseName ?? 'default'}:${workoutId}`;
  const current = activeSyncs.get(key);
  if (current) return current;
  const syncing = runSync(workoutId, options).finally(() => {
    if (activeSyncs.get(key) === syncing) activeSyncs.delete(key);
  });
  activeSyncs.set(key, syncing);
  return syncing;
}

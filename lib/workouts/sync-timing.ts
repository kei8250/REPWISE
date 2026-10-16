import { recoverPendingDeletion } from './deletion-recovery';
import { listWorkoutMutations } from './local-drafts';
import {
  syncPendingWorkoutMutations,
  type WorkoutSyncResult,
} from './sync-queue';
import type { WorkoutMutation } from './types';

const SETTING_KEY = 'repwise-sync-idle-ms';
const editingUntil = new Map<string, number>();

export function getSyncIdleMs() {
  try {
    return typeof window !== 'undefined' &&
      window.localStorage.getItem(SETTING_KEY) === '10000'
      ? 10000
      : 3000;
  } catch {
    return 3000;
  }
}

export function setSyncIdleMs(value: number) {
  if (value !== 3000 && value !== 10000)
    throw new Error('同期タイミングが正しくありません');
  window.localStorage.setItem(SETTING_KEY, String(value));
  window.dispatchEvent(new Event('repwise-settings-change'));
}

export function noteWorkoutEdit(workoutId: string, now = Date.now()) {
  editingUntil.set(workoutId, now + getSyncIdleMs());
}

export function nextAutomaticSyncDelay(
  workoutId: string,
  mutations: WorkoutMutation[],
  now = Date.now(),
) {
  const head = [...mutations].sort((a, b) => a.sequence - b.sequence)[0];
  if (!head || head.syncStatus === 'blocked' || head.syncStatus === 'conflict')
    return null;
  const retryAfter =
    head.syncStatus === 'failed' && head.lastAttemptAt
      ? Date.parse(head.lastAttemptAt) +
        Math.min(
          300_000,
          30_000 * 2 ** Math.min(Math.max(head.retryCount - 1, 0), 4),
        )
      : 0;
  return Math.max(
    0,
    (editingUntil.get(workoutId) ?? 0) - now,
    Number.isFinite(retryAfter) ? retryAfter - now : 0,
  );
}

export async function syncAutomatically(
  workoutId: string,
): Promise<WorkoutSyncResult> {
  let mutations = await listWorkoutMutations(workoutId);
  if (mutations[0]?.syncStatus === 'blocked' && await recoverPendingDeletion(workoutId).catch(() => false)) mutations = await listWorkoutMutations(workoutId);
  const delay = nextAutomaticSyncDelay(workoutId, mutations);
  if (delay === null || delay > 0)
    return {
      processed: 0,
      remaining: mutations.length,
      failed: mutations.find((item) => item.syncStatus !== 'pending') ?? null,
    };
  const result = await syncPendingWorkoutMutations(workoutId);
  if (result.failed?.syncStatus === 'blocked' && await recoverPendingDeletion(workoutId).catch(() => false)) return syncPendingWorkoutMutations(workoutId);
  return result;
}

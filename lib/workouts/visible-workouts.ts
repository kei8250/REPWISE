import { listWorkouts } from './api-client';
import {
  readLocalWorkoutSources,
  workoutToSummary,
  type LocalWorkoutDraft,
} from './local-drafts';
import type { WorkoutHistoryFilter } from './history';
import type { Workout, WorkoutMutation, WorkoutSummary } from './types';

export function mergeVisibleWorkouts(
  server: WorkoutSummary[],
  drafts: LocalWorkoutDraft[],
  mutations: WorkoutMutation[],
  status?: Workout['status'],
  filter: WorkoutHistoryFilter = {},
  serverAvailable = true,
) {
  const pending = new Set(mutations.map((item) => item.workoutId));
  const items = new Map(server.map((item) => [item.id, item]));
  for (const draft of drafts) {
    if (draft.workout.status === 'completed' && items.get(draft.workoutId)?.status === 'active') {
      items.delete(draft.workoutId);
    }
    const unsynced =
      pending.has(draft.workoutId) || draft.serverUpdatedAt === null;
    if (!unsynced && serverAvailable) continue;
    const workout = draft.workout;
    // A pending delete or status change also hides the old server summary.
    items.delete(workout.id);
    if (
      workout.deletedAt ||
      draft.draftStatus === 'deleted' ||
      (status && workout.status !== status) ||
      (filter.from && workout.localDate < filter.from) ||
      (filter.to && workout.localDate > filter.to)
    )
      continue;
    if (
      (filter.offset ?? 0) > 0 &&
      !server.some((item) => item.id === workout.id)
    )
      continue;
    items.set(workout.id, {
      ...workoutToSummary(workout),
      localOnly: true,
      pendingSync: unsynced,
    });
  }
  return [...items.values()].sort(
    (a, b) =>
      b.localDate.localeCompare(a.localDate) ||
      b.startedAt.localeCompare(a.startedAt) ||
      b.id.localeCompare(a.id),
  );
}

export async function loadVisibleWorkouts(
  status?: Workout['status'],
  limit = 30,
  filter: WorkoutHistoryFilter = {},
) {
  // Capture local snapshots before the GET so an ACK during the request cannot
  // remove an unsynced record before the server list has caught up.
  const local = await readLocalWorkoutSources().catch(() => ({
    drafts: [],
    mutations: [],
  }));
  try {
    const server = await listWorkouts(status, limit + 1, undefined, filter);
    return {
      items: mergeVisibleWorkouts(
        server.slice(0, limit),
        local.drafts,
        local.mutations,
        status,
        filter,
      ),
      serverCount: Math.min(server.length, limit),
      hasMore: server.length > limit,
      serverAvailable: true,
    };
  } catch (error) {
    const items = mergeVisibleWorkouts(
      [],
      local.drafts,
      local.mutations,
      status,
      filter,
      false,
    );
    if (!items.length) throw error;
    return { items, serverCount: 0, hasMore: false, serverAvailable: false };
  }
}

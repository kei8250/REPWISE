import { listWorkouts } from './api-client';
import {
  readLocalWorkoutSources,
  getExerciseMasterCacheRecord,
  workoutToSummary,
  type LocalWorkoutDraft,
} from './local-drafts';
import type { WorkoutHistoryFilter } from './history';
import type { ExerciseMaster, Workout, WorkoutMutation, WorkoutSummary } from './types';

export function mergeVisibleWorkouts(
  server: WorkoutSummary[],
  drafts: LocalWorkoutDraft[],
  mutations: WorkoutMutation[],
  status?: Workout['status'],
  filter: WorkoutHistoryFilter = {},
  serverAvailable = true,
  masters: ExerciseMaster[] = [],
) {
  const pending = new Set(mutations.map((item) => item.workoutId));
  const items = new Map(server.map((item) => [item.id, item]));
  const latest = new Map<string, WorkoutMutation>();
  for (const mutation of mutations) {
    if ((latest.get(mutation.workoutId)?.sequence ?? -1) < mutation.sequence) latest.set(mutation.workoutId, mutation);
  }
  for (const [id, mutation] of latest) {
    if (mutation.operation === 'delete' && !drafts.some((draft) => draft.workoutId === id)) items.delete(id);
  }
  for (const draft of drafts) {
    if (draft.draftStatus === 'deleted' || draft.workout.deletedAt) { items.delete(draft.workoutId); continue; }
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
      (status && workout.status !== status) ||
      (filter.from && workout.localDate < filter.from) ||
      (filter.to && workout.localDate > filter.to) ||
      ((filter.exerciseName || filter.bodyPart) && !workout.exercises.some(exercise => {
        const master = masters.find(item => item.id === exercise.exerciseId);
        const name = filter.exerciseName?.toLocaleLowerCase() ?? '';
        return (!name || exercise.exerciseNameSnapshot.toLocaleLowerCase().includes(name) || master?.name.toLocaleLowerCase().includes(name)) &&
          (!filter.bodyPart || master?.bodyPart === filter.bodyPart);
      }))
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
  // Keep IDs pending at request start, then reread snapshots after GET to honor later deletes.
  let local = await readLocalWorkoutSources().catch(() => ({
    drafts: [],
    mutations: [],
  }));
  const masters = (await getExerciseMasterCacheRecord().catch(() => null))?.exercises ?? [];
  try {
    const server = await listWorkouts(status, limit + 1, undefined, filter);
    const initiallyPending = new Set(local.mutations.map((item) => item.workoutId));
    local = await readLocalWorkoutSources();
    const acknowledgedDuringRead = local.drafts.filter((draft) => initiallyPending.has(draft.workoutId) && draft.draftStatus !== 'deleted' && !draft.workout.deletedAt && !server.some((row) => row.id === draft.workoutId) && (!status || draft.workout.status === status) && (!filter.from || draft.workout.localDate >= filter.from) && (!filter.to || draft.workout.localDate <= filter.to) && !filter.exerciseName && !filter.bodyPart).map((draft) => workoutToSummary(draft.workout));
    return {
      items: mergeVisibleWorkouts(
        [...server.slice(0, limit), ...acknowledgedDuringRead],
        local.drafts,
        local.mutations,
        status,
        filter,
        true,
        masters,
      ),
      serverCount: Math.min(server.length, limit),
      hasMore: server.length > limit,
      serverAvailable: true,
    };
  } catch (error) {
    local = await readLocalWorkoutSources();
    const items = mergeVisibleWorkouts(
      [],
      local.drafts,
      local.mutations,
      status,
      filter,
      false,
      masters,
    );
    if (!items.length) throw error;
    return { items, serverCount: 0, hasMore: false, serverAvailable: false };
  }
}


// Fill a visible page even if several raw server rows are hidden by local tombstones.
export async function loadVisibleWorkoutPage(status?: Workout['status'], limit = 8, filter: WorkoutHistoryFilter = {}) {
  let items: WorkoutSummary[] = [];
  let serverCount = 0;
  let hasMore = true;
  let serverAvailable = true;
  while (items.length < limit && hasMore) {
    const page = await loadVisibleWorkouts(status, Math.min(limit, 30), { ...filter, offset: (filter.offset ?? 0) + serverCount });
    items = [...new Map([...items, ...page.items].map(item => [item.id, item])).values()];
    serverCount += page.serverCount;
    hasMore = page.hasMore;
    serverAvailable = page.serverAvailable;
    if (page.serverCount === 0) break;
  }
  items.sort((a, b) => b.localDate.localeCompare(a.localDate) || b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  return { items, serverCount, hasMore, serverAvailable };
}

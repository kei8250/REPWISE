import type { LocalWorkoutDraft } from './local-drafts';
import type { WorkoutMutation } from './types';

export function summarizeSyncQueue(
  drafts: LocalWorkoutDraft[],
  mutations: WorkoutMutation[],
) {
  const groups = new Map<string, WorkoutMutation[]>();
  for (const mutation of mutations) {
    const queue = groups.get(mutation.workoutId) ?? [];
    queue.push(mutation);
    groups.set(mutation.workoutId, queue);
  }
  return [...groups].map(([id, pending]) => {
    const queue = [...pending].sort((a, b) => a.sequence - b.sequence);
    const draft = drafts.find((item) => item.workoutId === id);
    const latest = queue[queue.length - 1];
    // The latest local snapshot also accounts for Undo following a queued delete.
    const deleted = draft
      ? draft.draftStatus === 'deleted' || Boolean(draft.workout.deletedAt)
      : latest.operation === 'delete' ||
        Boolean(latest.payload.workout.deletedAt);
    return { id, draft, queue, head: queue[0], deleted };
  });
}

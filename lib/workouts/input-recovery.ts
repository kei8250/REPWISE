import { getWorkoutSyncState, type FetchLike } from './api-client';
import { readLocalWorkoutSources, replaceRejectedWorkoutChanges } from './local-drafts';
import { validateWorkoutMutation } from './validation';

export async function recoverCorrectedWorkout(id: string, options: { databaseName?: string; fetcher?: FetchLike } = {}) {
  const data = await readLocalWorkoutSources(options.databaseName);
  const draft = data.drafts.find(item => item.workoutId === id);
  const mutations = data.mutations.filter(item => item.workoutId === id).sort((a, b) => a.sequence - b.sequence);
  const head = mutations[0];
  const latest = mutations.at(-1);
  if (!draft || draft.workout.deletedAt || draft.draftStatus === 'deleted' || !head || !latest || head === latest ||
      head.syncStatus !== 'blocked' || !head.lastError?.includes('HTTP 400') || latest.syncStatus !== 'pending' || latest.retryCount !== 0 ||
      !['replace', 'edit', 'complete'].includes(latest.operation) || draft.localUpdatedAt > latest.createdAt) return false;
  try { validateWorkoutMutation(latest); } catch { return false; }
  const { workout: server } = await getWorkoutSyncState(id, options.fetcher);
  if (!server || server.deletedAt || server.version !== head.baseVersion || !['active', 'completed'].includes(server.status) ||
      (server.status === 'completed' && latest.payload.workout.status !== 'completed')) return false;
  const operation = server.status === 'completed' ? 'edit' : latest.payload.workout.status === 'completed' ? 'complete' : 'replace';
  if (operation === 'complete' && !latest.payload.workout.exercises.some(exercise => exercise.sets.some(set => set.status === 'completed' && set.actualLoadGrams !== null && set.actualReps !== null))) return false;
  return replaceRejectedWorkoutChanges(id, { draft, mutations }, server.version, options.databaseName, operation);
}

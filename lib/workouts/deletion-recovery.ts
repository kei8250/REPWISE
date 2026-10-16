import { getWorkoutSyncState, type FetchLike } from './api-client';
import { readLocalWorkoutSources, reconcileDeletedWorkout } from './local-drafts';

// A confirmed delete is user intent. Bypass obsolete blocked edits only when their
// expected base is still the current server version. Preserve all originals atomically.
export async function recoverPendingDeletion(id: string, options: { databaseName?: string; fetcher?: FetchLike } = {}) {
  const data = await readLocalWorkoutSources(options.databaseName);
  const draft = data.drafts.find(item => item.workoutId === id);
  const mutations = data.mutations.filter(item => item.workoutId === id).sort((a, b) => a.sequence - b.sequence);
  const head = mutations[0];
  if (!draft || draft.automaticDeletionRepairVersion !== undefined || draft.draftStatus !== 'deleted' || !draft.workout.deletedAt ||
      mutations.at(-1)?.operation !== 'delete' || head?.syncStatus !== 'blocked' ||
      mutations.some(item => item.syncStatus === 'syncing' || item.syncStatus === 'conflict')) return false;
  const { workout: server } = await getWorkoutSyncState(id, options.fetcher);
  if (!server) return false; // Missing cannot prove a possibly in-flight create was cancelled.
  if (!server.deletedAt && server.version !== head.baseVersion) return false;
  if (server.deletedAt && mutations.some(item => (item.retryCount > 0 || item.lastAttemptAt) && item.baseVersion >= server.version)) return false;
  await reconcileDeletedWorkout(id, server, { draft, mutations }, options.databaseName, true);
  return true;
}

import { getWorkout, type FetchLike } from './api-client';
import {
  getLocalWorkoutDraft,
  saveWorkoutDraftAndEnqueueMutation,
} from './local-drafts';

export async function deleteActiveWorkout(
  id: string,
  options: { databaseName?: string; fetcher?: FetchLike } = {},
) {
  const local = await getLocalWorkoutDraft(id, options.databaseName);
  const current = local?.workout ?? (await getWorkout(id, options.fetcher));
  if (current.status !== 'active')
    throw new Error(
      '入力途中の記録だけを削除できます。一覧を更新してください。',
    );
  if (current.deletedAt) return current;
  const timestamp = new Date().toISOString();
  const deleted = { ...current, deletedAt: timestamp, updatedAt: timestamp };
  await saveWorkoutDraftAndEnqueueMutation(deleted, 'delete', {
    databaseName: options.databaseName,
  });
  return deleted;
}

export async function restoreDeletedWorkout(id: string, databaseName?: string) {
  const local = await getLocalWorkoutDraft(id, databaseName);
  if (!local || !['active', 'completed'].includes(local.workout.status) || !local.workout.deletedAt)
    throw new Error('取り消せる削除記録がありません');
  const restored = {
    ...local.workout,
    deletedAt: null,
    updatedAt: new Date().toISOString(),
  };
  await saveWorkoutDraftAndEnqueueMutation(restored, 'restore', {
    databaseName,
  });
  return restored;
}

export const restoreActiveWorkout = restoreDeletedWorkout;

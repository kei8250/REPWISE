'use client';

import { invalidateAnalyticsDetail } from '@/lib/analytics/detail-cache';
import { invalidateHomeAnalyticsSummary } from '@/lib/analytics/home-cache';
import { useEffect } from 'react';
import { listWorkoutMutations, recoverLegacyWorkoutQueue, readLocalWorkoutSources, upgradeHiddenDeletion } from '@/lib/workouts/local-drafts';
import { syncAutomatically } from '@/lib/workouts/sync-timing';

export function SyncRecovery() {
  useEffect(() => {
    let active = true;
    const recover = async () => {
      await recoverLegacyWorkoutQueue().catch(() => undefined);
      const local = await readLocalWorkoutSources().catch(() => null);
      if (local) await Promise.all(local.drafts.filter(draft => draft.draftStatus === 'deleted' && !draft.permanentDeletionConfirmed).map(draft => upgradeHiddenDeletion(draft.workoutId).catch(() => undefined)));
      const queued = await listWorkoutMutations().catch(() => []);
      if (!active) return;
      const workoutIds = [...new Set(queued.map((item) => item.workoutId))];
      await Promise.all(
        workoutIds.map((workoutId) =>
          syncAutomatically(workoutId).catch(() => undefined),
        ),
      );
    };
    let changeTimer: number | undefined;
    const invalidate = () => {
      invalidateAnalyticsDetail(); invalidateHomeAnalyticsSummary();
      window.clearTimeout(changeTimer);
      changeTimer = window.setTimeout(() => void recover(), 750);
    };
    window.addEventListener('repwise-sync-queue-change', invalidate);
    void recover();
    const retryTimer = window.setInterval(() => void recover(), 30_000);
    window.addEventListener('online', recover);
    const changed = (event: StorageEvent) => {
      if (event.key === 'repwise-sync-notification') {
        window.dispatchEvent(new Event('repwise-sync-queue-change'));
        void recover();
      }
    };
    window.addEventListener('storage', changed);
    return () => {
      active = false;
      window.clearTimeout(changeTimer);
      window.removeEventListener('repwise-sync-queue-change', invalidate);
      window.clearInterval(retryTimer);
      window.removeEventListener('online', recover);
      window.removeEventListener('storage', changed);
    };
  }, []);
  return null;
}

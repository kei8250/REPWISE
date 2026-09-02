'use client';

import { useEffect } from 'react';
import { listWorkoutMutations } from '@/lib/workouts/local-drafts';
import { syncPendingWorkoutMutations } from '@/lib/workouts/sync-queue';

export function SyncRecovery() {
  useEffect(() => {
    let active = true;
    const recover = async () => {
      const queued = await listWorkoutMutations().catch(() => []);
      if (!active) return;
      const workoutIds = [...new Set(queued.map((item) => item.workoutId))];
      await Promise.all(
        workoutIds.map((workoutId) =>
          syncPendingWorkoutMutations(workoutId).catch(() => undefined),
        ),
      );
    };
    void recover();
    const retryTimer = window.setInterval(() => void recover(), 30_000);
    window.addEventListener('online', recover);
    return () => {
      active = false;
      window.clearInterval(retryTimer);
      window.removeEventListener('online', recover);
    };
  }, []);
  return null;
}

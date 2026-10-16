'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  loadGoalRecordedPerformances,
  type GoalAnalyticsData,
} from '@/lib/goals/recorded-performances';
import { GOALS_KEY, parseGoals } from '@/lib/goals/storage';
import { localToday } from '@/lib/goals/model';

function subscribe(update: () => void) {
  const changed = (event: StorageEvent) => {
    if (event.key === GOALS_KEY || event.key === null) update();
  };
  window.addEventListener('storage', changed);
  window.addEventListener('repwise-goals-change', update);
  window.addEventListener('focus', update);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener('repwise-goals-change', update);
    window.removeEventListener('focus', update);
  };
}
function snapshot() {
  try {
    return window.localStorage.getItem(GOALS_KEY);
  } catch {
    return 'unavailable';
  }
}
export function useSavedGoals() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const saved = useMemo(() => {
    try {
      return { goals: parseGoals(raw), error: false };
    } catch {
      return { goals: [], error: true };
    }
  }, [raw]);
  return saved;
}
export function useGoalProgress(exerciseId?: string) {
  const saved = useSavedGoals();
  const goals = saved.goals.filter(
    (g) =>
      g.status !== 'archived' && (!exerciseId || g.exerciseId === exerciseId),
  );
  const enabled = goals.length > 0;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    data: GoalAnalyticsData | null;
    error: boolean;
  }>({ data: null, error: false });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadGoalRecordedPerformances(attempt > 0).then(
      (data) => {
        if (active) setState({ data, error: false });
      },
      () => {
        if (active) setState({ data: null, error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, attempt]);
  useEffect(() => {
    const refresh = () => setAttempt((a) => a + 1);
    window.addEventListener('repwise-sync-queue-change', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('repwise-sync-queue-change', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return {
    goals,
    data: state.data,
    storageError: saved.error,
    error: state.error,
    today: localToday(),
    retry: () => setAttempt((a) => a + 1),
  };
}

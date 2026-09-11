'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WorkoutCompletionProgressionSummary } from '@/lib/progression/completion-summary';
import { getWorkoutCompletionProgressionSummary } from '@/lib/workouts/api-client';

export type WorkoutCompletionProgressionState =
  | { status: 'idle' | 'loading'; summary: null; error: null }
  | {
      status: 'success';
      summary: WorkoutCompletionProgressionSummary;
      error: null;
    }
  | { status: 'error'; summary: null; error: string };

type StoredResult = {
  key: string;
  state:
    | {
        status: 'success';
        summary: WorkoutCompletionProgressionSummary;
        error: null;
      }
    | { status: 'error'; summary: null; error: string };
};

export function useWorkoutCompletionProgression(
  workoutId: string,
  workoutVersion: number,
  enabled: boolean,
) {
  const [requestNumber, setRequestNumber] = useState(0);
  const [stored, setStored] = useState<StoredResult | null>(null);
  const key = `${workoutId}:${workoutVersion}:${requestNumber}`;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void getWorkoutCompletionProgressionSummary(workoutId)
      .then((summary) => {
        if (active)
          setStored({
            key,
            state: { status: 'success', summary, error: null },
          });
      })
      .catch(() => {
        if (active)
          setStored({
            key,
            state: {
              status: 'error',
              summary: null,
              error: '評価を取得できませんでした',
            },
          });
      });
    return () => {
      active = false;
    };
  }, [enabled, key, workoutId]);

  const retry = useCallback(() => {
    setStored(null);
    setRequestNumber((current) => current + 1);
  }, []);
  const state: WorkoutCompletionProgressionState = !enabled
    ? { status: 'idle', summary: null, error: null }
    : stored?.key === key
      ? stored.state
      : { status: 'loading', summary: null, error: null };
  return { state, retry };
}

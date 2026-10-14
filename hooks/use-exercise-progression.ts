'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createProgressionRequestCache,
  type ProgressionRequestCache,
} from '@/lib/progression/active-workout';
import type { ExerciseProgressionRecommendation } from '@/lib/progression/engine';
import { getExerciseProgressionRecommendation } from '@/lib/workouts/api-client';

export type ExerciseProgressionLoadState =
  | { status: 'idle'; recommendation: null; error: null }
  | { status: 'loading'; recommendation: null; error: null }
  | {
      status: 'success';
      recommendation: ExerciseProgressionRecommendation;
      error: null;
    }
  | { status: 'error'; recommendation: null; error: string };

type StoredResult = {
  contextKey: string;
  state: ExerciseProgressionLoadState;
};

export function useExerciseProgression(exerciseId: string | null, beforeDate?: string, beforeStartedAt?: string, excludeWorkoutId?: string) {
  const contextKey = `${exerciseId ?? ''}:${beforeDate ?? ''}:${beforeStartedAt ?? ''}:${excludeWorkoutId ?? ''}`;
  const cache = useMemo<ProgressionRequestCache>(
    () => createProgressionRequestCache(id => getExerciseProgressionRecommendation(id, undefined, { beforeDate, beforeStartedAt, excludeWorkoutId })),
    [beforeDate, beforeStartedAt, excludeWorkoutId],
  );
  const [stored, setStored] = useState<StoredResult | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);

  useEffect(() => {
    if (!exerciseId) return;
    let active = true;
    void cache
      .get(exerciseId)
      .then((recommendation) => {
        if (!active) return;
        setStored({
          contextKey,
          state: { status: 'success', recommendation, error: null },
        });
      })
      .catch((cause) => {
        if (!active) return;
        setStored({
          contextKey,
          state: {
            status: 'error',
            recommendation: null,
            error:
              cause instanceof Error
                ? cause.message
                : '前回記録を取得できませんでした',
          },
        });
      });
    return () => {
      active = false;
    };
  }, [cache, exerciseId, retryRevision, contextKey]);

  useEffect(() => {
    const refresh = () => { if (exerciseId) { cache.invalidate(exerciseId); setStored(null); setRetryRevision(current => current + 1); } };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [cache, exerciseId]);

  const retry = useCallback(() => {
    if (!exerciseId) return;
    cache.invalidate(exerciseId);
    setStored(null);
    setRetryRevision((current) => current + 1);
  }, [cache, exerciseId]);

  const state: ExerciseProgressionLoadState = !exerciseId
    ? { status: 'idle', recommendation: null, error: null }
    : stored?.contextKey === contextKey
      ? stored.state
      : { status: 'loading', recommendation: null, error: null };
  return { state, retry };
}

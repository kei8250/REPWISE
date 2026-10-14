'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getExerciseHistory } from '@/lib/workouts/api-client';
import type { ExerciseHistoryEntry } from '@/lib/workouts/history';

export function useExerciseHistory(
  exerciseId: string,
  beforeDate: string,
  excludeWorkoutId: string,
  enabled = true,
  beforeStartedAt?: string,
) {
  const key = `${exerciseId}:${beforeDate}:${excludeWorkoutId}:${beforeStartedAt ?? ''}`;
  const requestContext = useRef<{ cancelled: boolean; busy: boolean } | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    items: ExerciseHistoryEntry[];
    hasMore: boolean;
    status: 'loading' | 'success' | 'error';
    loadingMore: boolean;
    moreError: boolean;
  }>({
    key: '',
    items: [],
    hasMore: false,
    status: 'loading',
    loadingMore: false,
    moreError: false,
  });

  useEffect(() => {
    if (!enabled) return;
    const context = { cancelled: false, busy: false };
    requestContext.current = context;
    void getExerciseHistory(exerciseId, {
      beforeDate,
      beforeStartedAt,
      excludeWorkoutId,
    }).then(
      (page) => {
        if (!context.cancelled)
          setState({
            key,
            ...page,
            status: 'success',
            loadingMore: false,
            moreError: false,
          });
      },
      () => {
        if (!context.cancelled)
          setState({
            key,
            items: [],
            hasMore: false,
            status: 'error',
            loadingMore: false,
            moreError: false,
          });
      },
    );
    return () => {
      context.cancelled = true;
    };
  }, [
    exerciseId,
    beforeDate,
    excludeWorkoutId,
    beforeStartedAt,
    enabled,
    key,
    attempt,
  ]);

  const loadMore = useCallback(async () => {
    if (state.key !== key || state.loadingMore || !state.hasMore) return;
    const context = requestContext.current;
    if (!context || context.cancelled || context.busy) return;
    context.busy = true;
    setState((previous) => ({
      ...previous,
      loadingMore: true,
      moreError: false,
    }));
    try {
      const page = await getExerciseHistory(exerciseId, {
        beforeDate,
        beforeStartedAt,
        excludeWorkoutId,
        offset: state.items.length,
      });
      if (context.cancelled) return;
      setState((previous) => ({
        ...previous,
        items: [...previous.items, ...page.items],
        hasMore: page.hasMore,
        loadingMore: false,
      }));
    } catch {
      if (!context.cancelled)
        setState((previous) => ({
          ...previous,
          loadingMore: false,
          moreError: true,
        }));
    } finally {
      context.busy = false;
    }
  }, [state, key, exerciseId, beforeDate, beforeStartedAt, excludeWorkoutId]);

  const retry = () => {
    setState((previous) => ({ ...previous, key: '', status: 'loading' }));
    setAttempt((value) => value + 1);
  };
  return {
    ...state,
    items: state.key === key ? state.items : [],
    status: state.key === key ? state.status : ('loading' as const),
    loadMore,
    retry,
  };
}

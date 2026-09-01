'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { finishWorkout, getWorkout, saveWorkout } from '@/lib/workouts/api-client';
import type { SaveState, Workout } from '@/lib/workouts/types';

export function useActiveWorkout(id: string) {
  const [workout, setWorkoutState] = useState<Workout | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const workoutRef = useRef<Workout | null>(null);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);

  const setWorkout = useCallback((updater: Workout | ((current: Workout) => Workout)) => {
    setSaveState('saving');
    setError(null);
    setWorkoutState((current) => {
      if (!current) return current;
      const next = typeof updater === 'function' ? updater(current) : updater;
      workoutRef.current = next;
      revisionRef.current += 1;
      return next;
    });
  }, []);

  const persist = useCallback(async () => {
    const snapshot = workoutRef.current;
    if (!snapshot) throw new Error('保存するワークアウトがありません');
    const revision = revisionRef.current;
    setSaveState('saving');
    try {
      const saved = await saveWorkout(snapshot);
      savedRevisionRef.current = revision;
      setWorkoutState((current) => {
        if (!current || revisionRef.current !== revision) return current;
        workoutRef.current = saved;
        return saved;
      });
      if (revisionRef.current === revision) setSaveState('saved');
      setError(null);
      return saved;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '保存に失敗しました';
      setError(message);
      setSaveState('error');
      throw cause;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    getWorkout(id).then((loaded) => {
      if (!alive) return;
      workoutRef.current = loaded;
      revisionRef.current = 0;
      savedRevisionRef.current = 0;
      setWorkoutState(loaded);
      setSaveState('saved');
    }).catch((cause) => {
      if (!alive) return;
      setError(cause instanceof Error ? cause.message : '読み込みに失敗しました');
      setSaveState('error');
    });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    if (!workout || revisionRef.current === savedRevisionRef.current) return;
    const timer = window.setTimeout(() => { void persist().catch(() => undefined); }, 700);
    return () => window.clearTimeout(timer);
  }, [persist, workout]);

  const complete = useCallback(async () => {
    if (revisionRef.current !== savedRevisionRef.current) await persist();
    const completed = await finishWorkout(id);
    workoutRef.current = completed;
    setWorkoutState(completed);
    setSaveState('saved');
    return completed;
  }, [id, persist]);

  return { workout, setWorkout, saveState, error, retry: persist, complete };
}

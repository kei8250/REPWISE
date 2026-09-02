'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  finishWorkout,
  getWorkout,
  saveWorkout,
} from '@/lib/workouts/api-client';
import {
  getLocalWorkoutDraft,
  markLocalWorkoutDraftCompleted,
  saveActiveWorkoutDraft,
  selectWorkoutForRestore,
} from '@/lib/workouts/local-drafts';
import type { SaveState, Workout } from '@/lib/workouts/types';

export function useActiveWorkout(id: string) {
  const [workout, setWorkoutState] = useState<Workout | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [localSaveState, setLocalSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const workoutRef = useRef<Workout | null>(null);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const localRevisionRef = useRef(0);
  const localUpdatedAtRef = useRef<string | null>(null);
  const serverUpdatedAtRef = useRef<string | null>(null);

  const persistLocal = useCallback(
    async (
      snapshot: Workout,
      localUpdatedAt = new Date().toISOString(),
      serverUpdatedAt = serverUpdatedAtRef.current,
    ) => {
      const localRevision = localRevisionRef.current + 1;
      localRevisionRef.current = localRevision;
      localUpdatedAtRef.current = localUpdatedAt;
      setLocalSaveState('saving');
      setLocalError(null);
      try {
        const record = await saveActiveWorkoutDraft(snapshot, {
          localUpdatedAt,
          serverUpdatedAt,
        });
        if (localRevisionRef.current === localRevision) {
          setLocalSaveState('saved');
        }
        return record;
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'ローカル保存に失敗しました';
        setLocalError(message);
        setLocalSaveState('error');
        throw cause;
      }
    },
    [],
  );

  const setWorkout = useCallback(
    (updater: Workout | ((current: Workout) => Workout)) => {
      const current = workoutRef.current;
      if (!current) return;
      const next = typeof updater === 'function' ? updater(current) : updater;
      const localUpdatedAt = new Date().toISOString();
      workoutRef.current = next;
      revisionRef.current += 1;
      setWorkoutState(next);
      setSaveState('saving');
      setError(null);
      void persistLocal(next, localUpdatedAt).catch(() => undefined);
    },
    [persistLocal],
  );

  const persist = useCallback(async () => {
    const snapshot = workoutRef.current;
    if (!snapshot) throw new Error('保存するワークアウトがありません');
    const revision = revisionRef.current;
    const localUpdatedAt =
      localUpdatedAtRef.current ?? new Date().toISOString();
    setSaveState('saving');
    try {
      const saved = await saveWorkout(snapshot);
      savedRevisionRef.current = revision;
      serverUpdatedAtRef.current = saved.updatedAt;
      setWorkoutState((current) => {
        if (!current || revisionRef.current !== revision) return current;
        workoutRef.current = saved;
        return saved;
      });
      if (revisionRef.current === revision) {
        setSaveState('saved');
        await persistLocal(saved, localUpdatedAt, saved.updatedAt).catch(
          () => undefined,
        );
      }
      setError(null);
      return saved;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : '保存に失敗しました';
      setError(message);
      setSaveState('error');
      throw cause;
    }
  }, [persistLocal]);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([getWorkout(id), getLocalWorkoutDraft(id)]).then(
      async ([serverResult, localResult]) => {
        if (!alive) return;
        const serverWorkout =
          serverResult.status === 'fulfilled' ? serverResult.value : null;
        const localDraft =
          localResult.status === 'fulfilled' ? localResult.value : null;
        const restored = selectWorkoutForRestore(serverWorkout, localDraft);
        if (!restored.workout) {
          const cause =
            serverResult.status === 'rejected'
              ? serverResult.reason
              : new Error('ワークアウトを読み込めませんでした');
          setError(
            cause instanceof Error ? cause.message : '読み込みに失敗しました',
          );
          setSaveState('error');
          setLocalSaveState(localDraft ? 'saved' : 'error');
          return;
        }

        const loaded = restored.workout;
        workoutRef.current = loaded;
        serverUpdatedAtRef.current = serverWorkout?.updatedAt ?? null;
        localUpdatedAtRef.current =
          restored.source === 'local'
            ? (localDraft?.localUpdatedAt ?? loaded.updatedAt)
            : loaded.updatedAt;
        revisionRef.current = restored.source === 'local' ? 1 : 0;
        savedRevisionRef.current = 0;
        setWorkoutState(loaded);
        setSaveState(
          restored.source === 'local' && serverWorkout ? 'saving' : 'saved',
        );
        setLocalSaveState('saved');
        setError(null);
        setLocalError(null);

        if (loaded.status === 'active') {
          await persistLocal(
            loaded,
            localUpdatedAtRef.current,
            serverUpdatedAtRef.current,
          ).catch(() => undefined);
        } else {
          await markLocalWorkoutDraftCompleted(loaded).catch(() => undefined);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [id, persistLocal]);

  useEffect(() => {
    if (!workout || revisionRef.current === savedRevisionRef.current) return;
    const timer = window.setTimeout(() => {
      void persist().catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [persist, workout]);

  useEffect(() => {
    const flushLatestLocalSnapshot = () => {
      const snapshot = workoutRef.current;
      if (!snapshot || snapshot.status !== 'active') return;
      void saveActiveWorkoutDraft(snapshot, {
        localUpdatedAt: localUpdatedAtRef.current ?? new Date().toISOString(),
        serverUpdatedAt: serverUpdatedAtRef.current,
      }).catch(() => undefined);
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushLatestLocalSnapshot();
    };
    window.addEventListener('pagehide', flushLatestLocalSnapshot);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flushLatestLocalSnapshot);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, []);

  const complete = useCallback(async () => {
    if (revisionRef.current !== savedRevisionRef.current) await persist();
    const completed = await finishWorkout(id);
    workoutRef.current = completed;
    serverUpdatedAtRef.current = completed.updatedAt;
    setWorkoutState(completed);
    setSaveState('saved');
    try {
      await markLocalWorkoutDraftCompleted(completed);
      setLocalSaveState('saved');
      setLocalError(null);
    } catch (cause) {
      setLocalSaveState('error');
      setLocalError(
        cause instanceof Error
          ? cause.message
          : '完了状態をローカル保存できませんでした',
      );
    }
    return completed;
  }, [id, persist]);

  return {
    workout,
    setWorkout,
    saveState,
    localSaveState,
    error,
    localError,
    retry: persist,
    complete,
  };
}

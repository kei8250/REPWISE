'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkout } from '@/lib/workouts/api-client';
import {
  getLocalWorkoutDraft,
  listWorkoutMutations,
  saveActiveWorkoutDraft,
  saveWorkoutDraftAndEnqueueMutation,
  selectWorkoutForRestore,
} from '@/lib/workouts/local-drafts';
import {
  getWorkoutQueueState,
  isBrowserOffline,
  queueStateToSaveState,
  syncPendingWorkoutMutations,
} from '@/lib/workouts/sync-queue';
import type { SaveState, Workout } from '@/lib/workouts/types';

export function useActiveWorkout(id: string) {
  const [workout, setWorkoutState] = useState<Workout | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [localSaveState, setLocalSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [conflictBaseVersion, setConflictBaseVersion] = useState<number | null>(
    null,
  );
  const [serverReview, setServerReview] = useState<{
    version: number;
    updatedAt: string;
    status: Workout['status'];
  } | null>(null);
  const workoutRef = useRef<Workout | null>(null);
  const localRevisionRef = useRef(0);
  const serverUpdatedAtRef = useRef<string | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const refreshSyncState = useCallback(async () => {
    const queue = await getWorkoutQueueState(id);
    if (!mountedRef.current) return queue;
    const state = queueStateToSaveState(queue);
    setSaveState(state);
    setConflictBaseVersion(queue.conflictBaseVersion);
    if (state === 'conflict') {
      setError(
        '別の変更が存在するため、自動同期を停止しました。ローカル記録はこの端末に保持されています。',
      );
    } else if (state === 'error') {
      setError(queue.lastError ?? '同期に失敗しました');
    } else {
      setError(null);
    }
    return queue;
  }, [id]);

  const scheduleSync = useCallback(
    (delay = 80) => {
      clearRetryTimer();
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void syncPendingWorkoutMutations(id)
          .then(async () => {
            await refreshSyncState();
          })
          .catch(() => refreshSyncState());
      }, delay);
    },
    [clearRetryTimer, id, refreshSyncState],
  );

  const persistLocalMutation = useCallback(
    async (snapshot: Workout, operation: 'replace' | 'complete') => {
      const revision = localRevisionRef.current + 1;
      localRevisionRef.current = revision;
      setLocalSaveState('saving');
      setLocalError(null);
      setSaveState(isBrowserOffline() ? 'pending' : 'saving');
      try {
        await saveWorkoutDraftAndEnqueueMutation(snapshot, operation, {
          localUpdatedAt: snapshot.updatedAt,
          serverUpdatedAt: serverUpdatedAtRef.current,
        });
        if (mountedRef.current && localRevisionRef.current === revision) {
          setLocalSaveState('saved');
        }
        scheduleSync();
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : 'ローカル保存に失敗しました';
        if (mountedRef.current) {
          setLocalError(message);
          setLocalSaveState('error');
          setSaveState('error');
          setError(message);
        }
        throw cause;
      }
    },
    [scheduleSync],
  );

  const setWorkout = useCallback(
    (updater: Workout | ((current: Workout) => Workout)) => {
      const current = workoutRef.current;
      if (!current || current.status !== 'active') return;
      const nextValue =
        typeof updater === 'function' ? updater(current) : updater;
      const next = { ...nextValue, updatedAt: new Date().toISOString() };
      workoutRef.current = next;
      setWorkoutState(next);
      void persistLocalMutation(next, 'replace').catch(() => undefined);
    },
    [persistLocalMutation],
  );

  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    void Promise.allSettled([
      getWorkout(id),
      getLocalWorkoutDraft(id),
      listWorkoutMutations(id),
    ]).then(async ([serverResult, localResult, queueResult]) => {
      if (!alive) return;
      const serverWorkout =
        serverResult.status === 'fulfilled' ? serverResult.value : null;
      const localDraft =
        localResult.status === 'fulfilled' ? localResult.value : null;
      const queued =
        queueResult.status === 'fulfilled' ? queueResult.value : [];
      const restored = selectWorkoutForRestore(
        serverWorkout,
        localDraft,
        queued.length > 0,
      );
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
      setWorkoutState(loaded);
      setLocalSaveState('saved');
      setLocalError(null);

      if (
        restored.source === 'local' &&
        loaded.status === 'active' &&
        queued.length === 0
      ) {
        // Upgrade a Phase 1B-1a-only draft into the durable retry pipeline.
        await saveWorkoutDraftAndEnqueueMutation(loaded, 'replace', {
          localUpdatedAt: localDraft?.localUpdatedAt ?? loaded.updatedAt,
          serverUpdatedAt: serverWorkout?.updatedAt ?? null,
        });
      } else if (restored.source === 'server' && loaded.status === 'active') {
        await saveActiveWorkoutDraft(loaded, {
          localUpdatedAt: loaded.updatedAt,
          serverUpdatedAt: loaded.updatedAt,
        });
      }
      await refreshSyncState();
      scheduleSync();
    });
    return () => {
      alive = false;
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, id, refreshSyncState, scheduleSync]);

  useEffect(() => {
    const queueChanged = () => void refreshSyncState();
    const online = () => {
      void refreshSyncState();
      scheduleSync(0);
    };
    const offline = () => void refreshSyncState();
    window.addEventListener('repwise-sync-queue-change', queueChanged);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('repwise-sync-queue-change', queueChanged);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [refreshSyncState, scheduleSync]);

  useEffect(() => {
    const flushLatestLocalSnapshot = () => {
      const snapshot = workoutRef.current;
      if (!snapshot || snapshot.status !== 'active') return;
      void saveActiveWorkoutDraft(snapshot, {
        localUpdatedAt: snapshot.updatedAt,
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

  const retry = useCallback(async () => {
    if (!workoutRef.current) {
      window.location.reload();
      return;
    }
    clearRetryTimer();
    setSaveState('saving');
    await syncPendingWorkoutMutations(id, { manual: true });
    await refreshSyncState();
  }, [clearRetryTimer, id, refreshSyncState]);

  const reviewServer = useCallback(async () => {
    try {
      const server = await getWorkout(id);
      setServerReview({
        version: server.version,
        updatedAt: server.updatedAt,
        status: server.status,
      });
      return server;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'サーバー側の状態を確認できませんでした',
      );
      throw cause;
    }
  }, [id]);

  const complete = useCallback(async () => {
    const current = workoutRef.current;
    if (!current) throw new Error('終了するワークアウトがありません');
    if (!current.exercises.length)
      throw new Error('種目を1つ以上追加してください');
    if (
      !current.exercises
        .flatMap((exercise) => exercise.sets)
        .some((set) => set.status === 'completed')
    ) {
      throw new Error('完了したセットを1つ以上記録してください');
    }
    const endedAt = new Date().toISOString();
    const completed: Workout = {
      ...current,
      status: 'completed',
      endedAt,
      updatedAt: endedAt,
    };
    workoutRef.current = completed;
    setWorkoutState(completed);
    await persistLocalMutation(completed, 'complete');
    return completed;
  }, [persistLocalMutation]);

  return {
    workout,
    setWorkout,
    saveState,
    localSaveState,
    error,
    localError,
    retry,
    reviewServer,
    serverReview,
    conflictBaseVersion,
    complete,
  };
}

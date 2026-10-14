'use client';

import { getSyncIdleMs, noteWorkoutEdit, syncAutomatically } from '@/lib/workouts/sync-timing';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkout } from '@/lib/workouts/api-client';
import {
  isUsableActiveWorkoutDraft,
  loadActiveWorkoutSourcesLocalFirst,
  shouldAdoptServerWorkout,
  shouldUpgradeLocalDraftToQueue,
} from '@/lib/workouts/active-workout-loader';
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
  const serverVersionRef = useRef(0);
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
    (delay = getSyncIdleMs()) => {
      clearRetryTimer();
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void syncAutomatically(id)
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
        if (mountedRef.current) scheduleSync();
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
      clearRetryTimer();
      noteWorkoutEdit(id);
      const next = { ...nextValue, updatedAt: new Date().toISOString() };
      workoutRef.current = next;
      setWorkoutState(next);
      void persistLocalMutation(next, 'replace').catch(() => undefined);
    },
    [persistLocalMutation, clearRetryTimer, id],
  );

  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    const initializationRevision = localRevisionRef.current;
    let localWasDisplayed = false;
    void loadActiveWorkoutSourcesLocalFirst({
      workoutId: id,
      loadServer: () => getWorkout(id),
      loadLocal: () => getLocalWorkoutDraft(id),
      loadQueue: () => listWorkoutMutations(id),
      onLocalReady: (draft) => {
        if (!alive) return;
        localWasDisplayed = true;
        workoutRef.current = draft.workout;
        serverUpdatedAtRef.current = draft.serverUpdatedAt;
        serverVersionRef.current = Math.max(
          draft.workout.version,
          draft.serverVersion ?? 0,
        );
        setWorkoutState(draft.workout);
        setLocalSaveState('saved');
        setLocalError(null);
        setError(null);
        setSaveState(isBrowserOffline() ? 'pending' : 'saving');
      },
      onQueueReady: (queue) => {
        if (!alive || !localWasDisplayed) return;
        if (queue.length > 0) void refreshSyncState();
        else if (isBrowserOffline()) setSaveState('pending');
      },
    }).then(async (initial) => {
      if (!alive) return;

      // The user can edit while the server request is in flight. Re-read both
      // local stores so reconciliation never reasons from the mount-time copy.
      const [latestLocalResult, latestQueueResult] = await Promise.allSettled([
        getLocalWorkoutDraft(id),
        listWorkoutMutations(id),
      ]);
      if (!alive) return;
      const serverWorkout =
        initial.server.status === 'fulfilled' ? initial.server.value : null;
      const localDraft =
        latestLocalResult.status === 'fulfilled'
          ? latestLocalResult.value
          : initial.local.status === 'fulfilled'
            ? initial.local.value
            : null;
      const queued =
        latestQueueResult.status === 'fulfilled'
          ? latestQueueResult.value
          : initial.queue.status === 'fulfilled'
            ? initial.queue.value
            : [];
      const restored = selectWorkoutForRestore(
        serverWorkout,
        localDraft,
        queued.length > 0,
      );
      if (!restored.workout) {
        if (localWasDisplayed && isUsableActiveWorkoutDraft(localDraft, id)) {
          // Network failure must not turn a usable local workout into a full
          // page error. The draft stays editable until verification recovers.
          setSaveState('pending');
          setError(null);
          return;
        }
        const cause =
          initial.server.status === 'rejected'
            ? initial.server.reason
            : new Error('ワークアウトを読み込めませんでした');
        setError(
          cause instanceof Error ? cause.message : '読み込みに失敗しました',
        );
        setSaveState('error');
        setLocalSaveState(localDraft ? 'saved' : 'error');
        return;
      }

      const loaded = restored.workout;
      if (!serverWorkout && !localWasDisplayed) {
        serverUpdatedAtRef.current = localDraft?.serverUpdatedAt ?? null;
        serverVersionRef.current = Math.max(
          loaded.version,
          localDraft?.serverVersion ?? 0,
        );
      }
      const adoptServer =
        restored.source === 'server' &&
        shouldAdoptServerWorkout({
          serverWorkout: loaded,
          currentWorkout: workoutRef.current,
          localDraft,
          localWasDisplayed,
          queuedMutationCount: queued.length,
          initializationRevision,
          currentRevision: localRevisionRef.current,
        });
      const canRecognizeServerRevision =
        !!serverWorkout &&
        (!localWasDisplayed ||
          (queued.length === 0 &&
            localRevisionRef.current === initializationRevision));
      if (
        canRecognizeServerRevision &&
        serverWorkout.version >= serverVersionRef.current
      ) {
        serverUpdatedAtRef.current = serverWorkout.updatedAt;
        serverVersionRef.current = serverWorkout.version;
      }
      if (!localWasDisplayed || adoptServer) {
        const recognizedVersion = Math.max(
          loaded.version,
          serverVersionRef.current,
        );
        const adopted =
          loaded.version === recognizedVersion
            ? loaded
            : { ...loaded, version: recognizedVersion };
        workoutRef.current = adopted;
        setWorkoutState(adopted);
      }
      setLocalSaveState('saved');
      setLocalError(null);

      if (
        restored.source === 'local' &&
        loaded.status === 'active' &&
        shouldUpgradeLocalDraftToQueue(localDraft, queued.length)
      ) {
        // Upgrade a Phase 1B-1a-only draft into the durable retry pipeline.
        const current = workoutRef.current ?? loaded;
        await saveWorkoutDraftAndEnqueueMutation(current, 'replace', {
          localUpdatedAt: localDraft?.localUpdatedAt ?? loaded.updatedAt,
          serverUpdatedAt: serverWorkout?.updatedAt ?? null,
        });
      } else if (
        restored.source === 'server' &&
        adoptServer &&
        loaded.status === 'active'
      ) {
        const current = workoutRef.current ?? loaded;
        await saveActiveWorkoutDraft(current, {
          localUpdatedAt: current.updatedAt,
          serverUpdatedAt: serverWorkout?.updatedAt ?? current.updatedAt,
        });
      }
      const queueState = await refreshSyncState();
      if (
        initial.server.status === 'rejected' &&
        localWasDisplayed &&
        queueState.total === 0
      ) {
        setSaveState('pending');
      }
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
      const versionSafeSnapshot =
        snapshot.version >= serverVersionRef.current
          ? snapshot
          : { ...snapshot, version: serverVersionRef.current };
      void saveActiveWorkoutDraft(versionSafeSnapshot, {
        localUpdatedAt: versionSafeSnapshot.updatedAt,
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
    try {
      await persistLocalMutation(completed, 'complete');
      return completed;
    } catch (cause) {
      workoutRef.current = current;
      setWorkoutState(current);
      throw cause;
    }
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

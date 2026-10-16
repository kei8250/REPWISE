'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkout, WorkoutApiError } from '@/lib/workouts/api-client';
import {
  getLocalWorkoutDraft,
  listWorkoutMutations,
  saveWorkoutDraftAndEnqueueMutation,
} from '@/lib/workouts/local-drafts';
import {
  getWorkoutQueueState,
  queueStateToSaveState,
  isBrowserOffline,
  syncPendingWorkoutMutations,
} from '@/lib/workouts/sync-queue';
import {
  getSyncIdleMs,
  noteWorkoutEdit,
  syncAutomatically,
} from '@/lib/workouts/sync-timing';
import { normalizeRecordedWorkout } from '@/lib/workouts/instant-recording';
import type { SaveState, Workout } from '@/lib/workouts/types';

export function useRecordingWorkout(id: string) {
  const [workout, setState] = useState<Workout | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const [localSaveState, setLocalSaveState] = useState<SaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [serverReview, setServerReview] = useState<Workout | null>(null);
  const [conflictBaseVersion, setConflict] = useState<number | null>(null);
  const current = useRef<Workout | null>(null);
  const revision = useRef(0);
  const mounted = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFailed = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const [queue, local] = await Promise.all([
        getWorkoutQueueState(id),
        getLocalWorkoutDraft(id),
      ]);
      if (!mounted.current) return;
      if (local?.draftStatus === 'deleted' || local?.workout.deletedAt) {
        current.current = null;
        setState(null);
        setError('この記録は削除されました。');
        setSaveState('error');
        return;
      }
      if (local && current.current)
        current.current = {
          ...current.current,
          version: Math.max(current.current.version, local.serverVersion ?? 0),
        };
      if (saveFailed.current) return;
      setSaveState(queueStateToSaveState(queue));
      setConflict(queue.conflictBaseVersion);
      setError(queue.lastError);
    } catch {
      if (mounted.current) {
        setSaveState('error');
        setError(
          '端末の保存状態を確認できません。記録は画面に保持しています。',
        );
      }
    }
  }, [id]);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void syncAutomatically(id)
        .then(refresh)
        .catch(() => refresh());
    }, getSyncIdleMs());
  }, [id, refresh]);
  const persist = useCallback(
    (snapshot: Workout) => {
      const version = ++revision.current;
      setLocalSaveState('saving');
      setLocalError(null);
      saveFailed.current = false;
      setSaveState(isBrowserOffline() ? 'pending' : 'saving');
      // Start every IndexedDB transaction immediately; IDB orders read/write transactions.
      const task = saveWorkoutDraftAndEnqueueMutation(snapshot, 'edit', {
        autoRecord: true,
      })
        .then(() => {
          if (mounted.current && revision.current === version) {
            setLocalSaveState('saved');
            saveFailed.current = false;
            setLocalError(null);
          }
          if (mounted.current) schedule();
        })
        .catch((cause) => {
          if (mounted.current && revision.current === version) {
            saveFailed.current = true;
            const message =
              cause instanceof Error
                ? cause.message
                : '端末に保存できませんでした';
            setLocalSaveState('error');
            setSaveState('error');
            setLocalError(message);
            setError(message);
          }
          throw cause;
        });
      writes.current = Promise.all([
        writes.current.catch(() => undefined),
        task,
      ]).then(() => undefined);
      void writes.current.catch(() => undefined);
    },
    [schedule],
  );
  const setWorkout = useCallback(
    (update: Workout | ((value: Workout) => Workout)) => {
      const previous = current.current;
      if (!previous || previous.deletedAt || previous.status !== 'completed')
        return;
      const next = normalizeRecordedWorkout(
        typeof update === 'function' ? update(previous) : update,
      );
      current.current = next;
      setState(next);
      noteWorkoutEdit(id);
      persist(next);
    },
    [id, persist],
  );
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const atStart = revision.current;
    const requestedAt = Date.now();
    const server = getWorkout(id).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    );
    const local = getLocalWorkoutDraft(id);
    const queue = listWorkoutMutations(id);
    void local
      .then((value) => {
        if (
          alive &&
          value &&
          value.draftStatus !== 'deleted' &&
          !value.workout.deletedAt &&
          value.workout.status === 'completed'
        ) {
          current.current = value.workout;
          setState(value.workout);
          setLocalSaveState('saved');
        }
      })
      .catch(() => undefined);
    void Promise.all([
      server,
      local.catch(() => null),
      queue.catch(() => []),
    ]).then(async ([remote, cached]) => {
      if (!alive) return;
      let queueUnavailable = false;
      const [latest, pending] = await Promise.all([
        getLocalWorkoutDraft(id).catch(() => cached),
        listWorkoutMutations(id).catch(() => {
          queueUnavailable = true;
          return [];
        }),
      ]);
      if (!alive) return;
      if (
        latest?.draftStatus === 'deleted' ||
        latest?.workout.deletedAt ||
        remote.value?.deletedAt ||
        (remote.error instanceof WorkoutApiError &&
          remote.error.status === 410) ||
        (remote.error instanceof WorkoutApiError &&
          remote.error.status === 404 &&
          !queueUnavailable &&
          !pending.some((mutation) => mutation.operation === 'create') &&
          !(
            latest?.serverUpdatedAt &&
            Date.parse(latest.serverUpdatedAt) >= requestedAt
          ))
      ) {
        current.current = null;
        setState(null);
        setError('この記録は削除されました。');
        setSaveState('error');
        return;
      }
      // Do not replace edits made while the GET was in flight, or queued local writes.
      const localValue =
        latest?.workout.status === 'completed' ? latest.workout : null;
      const value =
        queueUnavailable || pending.length || revision.current !== atStart
          ? (current.current ?? localValue)
          : remote.value &&
              (!localValue ||
                remote.value.version >
                  (latest?.serverVersion ?? localValue.version))
            ? remote.value
            : (localValue ?? remote.value);
      if (!value || value.status !== 'completed') {
        setError(
          '記録を読み込めませんでした。ホームから記録を追加してください。',
        );
        setSaveState('error');
        return;
      }
      if (revision.current === atStart) {
        current.current = value;
        setState(value);
        setLocalSaveState('saved');
      }
      await refresh();
      if (alive) schedule();
    });
    const changed = () => {
      void refresh();
    };
    const online = () => {
      void syncAutomatically(id)
        .then(refresh)
        .catch(() => refresh());
    };
    window.addEventListener('repwise-sync-queue-change', changed);
    window.addEventListener('online', online);
    return () => {
      alive = false;
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('repwise-sync-queue-change', changed);
      window.removeEventListener('online', online);
    };
  }, [id, refresh, schedule]);
  const retry = useCallback(async () => {
    if (saveFailed.current && current.current) {
      persist(current.current);
      await writes.current;
    }
    await syncPendingWorkoutMutations(id, { manual: true });
    await refresh();
  }, [id, refresh, persist]);
  const reviewServer = useCallback(async () => {
    const value = await getWorkout(id);
    setServerReview(value);
    return value;
  }, [id]);
  const flush = useCallback(async () => {
    await writes.current;
    if (saveFailed.current)
      throw new Error('端末への保存に失敗しています。再試行してください。');
    return current.current;
  }, []);
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
    flush,
  };
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronLeft, CloudOff, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getWorkout } from '@/lib/workouts/api-client';
import {
  getLocalWorkoutDraft,
  listWorkoutMutations,
  selectWorkoutDetailForDisplay,
} from '@/lib/workouts/local-drafts';
import {
  getWorkoutQueueState,
  isBrowserOffline,
  syncPendingWorkoutMutations,
} from '@/lib/workouts/sync-queue';
import type { Workout } from '@/lib/workouts/types';
import { APP_ROUTES } from '@/lib/routes';

export function WorkoutDetail({ id }: { id: string }) {
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<
    'saved' | 'syncing' | 'pending' | 'error'
  >('saved');
  const refreshSyncState = useCallback(async () => {
    const queue = await getWorkoutQueueState(id);
    if (queue.blocked || (queue.failed && !isBrowserOffline())) {
      setSyncState('error');
    } else if (queue.syncing) {
      setSyncState('syncing');
    } else if (queue.total) {
      setSyncState('pending');
    } else {
      setSyncState('saved');
    }
  }, [id]);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      getWorkout(id),
      getLocalWorkoutDraft(id),
      listWorkoutMutations(id),
    ]).then(([serverResult, localResult, queueResult]) => {
      if (!active) return;
      const server =
        serverResult.status === 'fulfilled' ? serverResult.value : null;
      const local =
        localResult.status === 'fulfilled' ? localResult.value : null;
      const queued =
        queueResult.status === 'fulfilled' ? queueResult.value : [];
      const selected = selectWorkoutDetailForDisplay(
        server,
        local,
        queued.length > 0,
      );
      if (selected.workout) {
        setWorkout(selected.workout);
        setError(null);
      } else {
        const cause =
          serverResult.status === 'rejected'
            ? serverResult.reason
            : new Error('記録を読み込めませんでした');
        setError(
          cause instanceof Error ? cause.message : '記録を読み込めませんでした',
        );
      }
    });
    const queueChanged = () => void refreshSyncState();
    const initialQueueTimer = window.setTimeout(queueChanged, 0);
    window.addEventListener('repwise-sync-queue-change', queueChanged);
    return () => {
      active = false;
      window.clearTimeout(initialQueueTimer);
      window.removeEventListener('repwise-sync-queue-change', queueChanged);
    };
  }, [id, refreshSyncState]);
  if (!workout)
    return (
      <div className="grid min-h-72 place-items-center">
        {error ? (
          <p className="text-sm font-bold text-destructive">{error}</p>
        ) : (
          <LoaderCircle className="animate-spin text-primary" />
        )}
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-7 lg:py-10">
      <a
        href={APP_ROUTES.history}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <ChevronLeft /> 履歴へ
      </a>
      <div>
        <Badge variant="secondary">
          {workout.status === 'completed' ? '完了済み' : '入力途中'}
        </Badge>
        {syncState !== 'saved' && (
          <button
            type="button"
            data-sync-state={syncState}
            onClick={() => {
              if (syncState === 'error') {
                setSyncState('syncing');
                void syncPendingWorkoutMutations(id, { manual: true }).then(
                  () => refreshSyncState(),
                );
              }
            }}
            className={`ml-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${syncState === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-amber-100 text-amber-800'}`}
          >
            {syncState === 'syncing' ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <CloudOff className="size-3" />
            )}
            {syncState === 'error'
              ? '同期失敗・再試行'
              : syncState === 'syncing'
                ? '同期中…'
                : 'この端末に保存済み・同期待ち'}
          </button>
        )}
        <h1 className="mt-3 text-3xl font-black">{workout.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {workout.localDate} · {workout.exercises.length}種目
        </p>
      </div>
      {workout.exercises.map((exercise, exerciseIndex) => (
        <Card key={exercise.id} className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <p className="text-xs font-bold text-primary">
              EXERCISE {exerciseIndex + 1}
            </p>
            <h2 className="mt-1 text-xl font-black">
              {exercise.exerciseNameSnapshot}
            </h2>
            <div className="mt-4 space-y-2">
              {exercise.sets.map((set, setIndex) => (
                <div key={set.id} className="rounded-xl bg-muted/65 p-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-7 place-items-center rounded-full bg-card text-xs font-black">
                      {set.status === 'completed' ? (
                        <Check className="size-4 text-primary" />
                      ) : (
                        setIndex + 1
                      )}
                    </span>
                    <p className="font-black">
                      {set.actualLoadGrams === null
                        ? '—'
                        : `${set.actualLoadGrams / 1000} kg`}{' '}
                      × {set.actualReps ?? '—'} reps
                    </p>
                  </div>
                  {(set.targetLoadGrams !== null ||
                    set.targetRepMin !== null ||
                    set.targetRepMax !== null) && (
                    <p className="mt-2 pl-10 text-xs text-muted-foreground">
                      目標:{' '}
                      {set.targetLoadGrams === null
                        ? '—'
                        : `${set.targetLoadGrams / 1000} kg`}{' '}
                      × {set.targetRepMin ?? '—'}〜{set.targetRepMax ?? '—'}{' '}
                      reps
                    </p>
                  )}
                  {set.memo && (
                    <p className="mt-2 pl-10 text-sm text-muted-foreground">
                      {set.memo}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {exercise.note && (
              <p className="mt-4 rounded-xl border p-3 text-sm text-muted-foreground">
                {exercise.note}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
      {workout.overallNote && (
        <Card className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <p className="text-sm font-black">全体メモ</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {workout.overallNote}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

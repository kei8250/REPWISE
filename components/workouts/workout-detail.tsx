'use client';

import { reportInvalidWorkoutInput } from './validated-number-input';
import { prepareWorkoutCompletion } from '@/lib/workouts/completion';
import { validateWorkoutSnapshot } from '@/lib/workouts/validation';
import { repsLabel } from '@/lib/workouts/reps';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  CloudOff,
  LoaderCircle,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getWorkout, WorkoutApiError } from '@/lib/workouts/api-client';
import { copyWorkoutForToday } from '@/lib/workouts/draft';
import {
  getLocalWorkoutDraft,
  listWorkoutMutations,
  cancelCompletedWorkoutEdit,
  repairCompletedWorkoutDraft,
  saveCompletedWorkoutEditDraft,
  saveWorkoutDraftAndEnqueueMutation,
  selectWorkoutDetailForDisplay,
} from '@/lib/workouts/local-drafts';
import {
  getWorkoutQueueState,
  isBrowserOffline,
  syncPendingWorkoutMutations,
} from '@/lib/workouts/sync-queue';
import type { Workout } from '@/lib/workouts/types';
import { APP_ROUTES, navigateTo } from '@/lib/routes';
import { CompletedWorkoutEditor } from './completed-workout-editor';
import { ReviewConflictControl } from './review-conflict-control';
import { WorkoutProgressionSummary } from './workout-progression-summary';
import { PastExerciseHistory } from './exercise-history';

type DetailSyncState = 'saved' | 'syncing' | 'pending' | 'error' | 'conflict';

export function WorkoutDetail({ id }: { id: string }) {
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [serverBaseline, setServerBaseline] = useState<Workout | null>(null);
  const [editing, setEditing] = useState(false);
  const [savingLocally, setSavingLocally] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<DetailSyncState>('saved');
  const [serverReview, setServerReview] = useState<Workout | null>(null);
  const [conflictBaseVersion, setConflictBaseVersion] = useState<number | null>(
    null,
  );
  const [serverReviewError, setServerReviewError] = useState<string | null>(
    null,
  );
  const [startingCopy, setStartingCopy] = useState(false);
  const startingCopyRef = useRef(false);
  const serverKnownMissingRef = useRef(false);
  const missingServerVersionRef = useRef<number | null>(null);

  const refreshSyncState = useCallback(async () => {
    const queue = await getWorkoutQueueState(id);
    setConflictBaseVersion(queue.conflictBaseVersion);
    if (queue.conflict) setSyncState('conflict');
    else if (queue.blocked || (queue.failed && !isBrowserOffline()))
      setSyncState('error');
    else if (queue.syncing) setSyncState('syncing');
    else if (queue.total) setSyncState('pending');
    else setSyncState('saved');
    if ((queue.blocked || queue.failed || queue.conflict) && queue.lastError) setError(queue.lastError);
    return queue;
  }, [id]);

  const refreshLocalWorkout = useCallback(async () => {
    const local = await getLocalWorkoutDraft(id).catch(() => null);
    const queued = await listWorkoutMutations(id).catch(() => []);
    if (local) {
      const selected = selectWorkoutDetailForDisplay(
        null,
        local,
        queued.length > 0,
        serverKnownMissingRef.current,
        missingServerVersionRef.current,
      );
      setWorkout(selected.workout);
    }
    return local;
  }, [id]);

  const reviewServer = useCallback(async () => {
    setServerReviewError(null);
    try {
      const server = await getWorkout(id);
      setServerReview(server);
    } catch (cause) {
      setServerReviewError(
        cause instanceof Error
          ? cause.message
          : 'サーバー側を確認できませんでした',
      );
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    serverKnownMissingRef.current = false;
    missingServerVersionRef.current = null;
    void Promise.allSettled([
      getWorkout(id),
      getLocalWorkoutDraft(id),
      listWorkoutMutations(id),
    ]).then(async ([serverResult, localResult, queueResult]) => {
      if (!active) return;
      const server =
        serverResult.status === 'fulfilled' ? serverResult.value : null;
      let local =
        localResult.status === 'fulfilled' ? localResult.value : null;
      let queued =
        queueResult.status === 'fulfilled' ? queueResult.value : [];
      const [latestLocal, latestQueue] = await Promise.allSettled([getLocalWorkoutDraft(id), listWorkoutMutations(id)]);
      if (!active) return;
      if (latestLocal.status === 'fulfilled') local = latestLocal.value;
      if (latestQueue.status === 'fulfilled') queued = latestQueue.value;
      let repairError: string | null = null;
      if (local?.draftStatus === 'completed' && local.workout.status !== 'completed') {
        try {
          await repairCompletedWorkoutDraft(server ?? local.workout);
          local = await getLocalWorkoutDraft(id);
        } catch { repairError = '端末の保存状態を修復できませんでした。サーバーの完了記録を表示します。'; }
        if (!active) return;
      }
      const serverKnownMissing =
        serverResult.status === 'rejected' &&
        serverResult.reason instanceof WorkoutApiError &&
        serverResult.reason.status === 404;
      serverKnownMissingRef.current = serverKnownMissing;
      missingServerVersionRef.current = local?.workout.version ?? null;
      const selected = selectWorkoutDetailForDisplay(
        server,
        local,
        queued.length > 0,
        serverKnownMissing,
      );
      if (server?.status === 'completed') setServerBaseline(server);
      if (selected.workout) {
        setWorkout(selected.workout);
        setEditing(local?.draftStatus === 'completed_edit');
        setError(repairError);
      } else {
        setWorkout(null);
        const cause =
          serverResult.status === 'rejected'
            ? serverResult.reason
            : new Error('記録を読み込めませんでした');
        setError(
          cause instanceof Error ? cause.message : '記録を読み込めませんでした',
        );
      }
    });
    const queueChanged = () => {
      void refreshSyncState();
      void refreshLocalWorkout();
    };
    const initialQueueTimer = window.setTimeout(queueChanged, 0);
    window.addEventListener('repwise-sync-queue-change', queueChanged);
    return () => {
      active = false;
      window.clearTimeout(initialQueueTimer);
      window.removeEventListener('repwise-sync-queue-change', queueChanged);
    };
  }, [id, refreshLocalWorkout, refreshSyncState]);

  const persistEdit = useCallback(async (next: Workout) => {
    setWorkout(next);
    setSavingLocally(true);
    try {
      await saveCompletedWorkoutEditDraft(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '端末へ編集内容を保存できませんでした');
    } finally {
      setSavingLocally(false);
    }
  }, []);

  async function beginEdit() {
    if (!workout) return;
    const next = { ...structuredClone(workout), deletedAt: null };
    setEditing(true);
    await persistEdit(next);
  }

  async function saveEdit() {
    if (!workout || reportInvalidWorkoutInput()) return;
    let checked: Workout;
    try { checked = { ...prepareWorkoutCompletion(workout), endedAt: workout.endedAt }; validateWorkoutSnapshot(checked); } catch (cause) { setError(cause instanceof Error ? cause.message : '入力内容を確認してください'); return; }
    setSavingLocally(true);
    setSyncState('syncing');
    try {
      await saveWorkoutDraftAndEnqueueMutation(
        { ...checked, status: 'completed', deletedAt: null },
        'edit',
      );
      const result = await syncPendingWorkoutMutations(id);
      const queue = await refreshSyncState();
      const local = await refreshLocalWorkout();
      if (!result.failed && queue.total === 0) {
        if (local) setServerBaseline(local.workout);
        setEditing(false);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '変更を保存できませんでした',
      );
      setSyncState('error');
    } finally {
      setSavingLocally(false);
    }
  }

  async function cancelEdit() {
    setSavingLocally(true);
    try {
      const restored = await cancelCompletedWorkoutEdit(id, { serverWorkout: serverBaseline });
      setWorkout(restored);
      setEditing(false);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '編集を取り消せませんでした'); }
    finally { setSavingLocally(false); }
  }

  async function deleteWorkout() {
    if (!workout) return;
    const changedAt = new Date().toISOString();
    const deleted = {
      ...workout,
      status: 'completed' as const,
      deletedAt: changedAt,
      updatedAt: changedAt,
    };
    setWorkout(deleted);
    setSyncState('syncing');
    try {
      await saveWorkoutDraftAndEnqueueMutation(deleted, 'delete', { permanentDelete: true });
      await syncPendingWorkoutMutations(id);
      await refreshSyncState();
      await refreshLocalWorkout();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '削除を保存できませんでした',
      );
      setSyncState('error');
    }
  }

  async function retrySync() {
    setSyncState('syncing');
    try {
      await syncPendingWorkoutMutations(id, { manual: true });
      await refreshSyncState();
      await refreshLocalWorkout();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '同期できませんでした'); setSyncState('error'); }
  }

  async function startSameMenu() {
    if (
      !workout ||
      workout.status !== 'completed' ||
      workout.deletedAt ||
      syncState === 'conflict' ||
      startingCopyRef.current
    ) {
      return;
    }
    startingCopyRef.current = true;
    setStartingCopy(true);
    setError(null);
    try {
      const copied = copyWorkoutForToday(workout);
      await saveWorkoutDraftAndEnqueueMutation(copied, 'create', {
        localUpdatedAt: copied.updatedAt,
        serverUpdatedAt: null,
      });
      void syncPendingWorkoutMutations(copied.id).catch(() => undefined);
      navigateTo(APP_ROUTES.activeWorkout(copied.id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '同じメニューを開始できませんでした',
      );
      startingCopyRef.current = false;
      setStartingCopy(false);
    }
  }

  if (!workout)
    return (
      <div className="grid min-h-72 place-items-center">
        {error ? (
          <div className="p-6 text-center">
            <p className="text-sm font-bold text-destructive">{error}</p>
            <a href={APP_ROUTES.history} className="mt-4 block min-h-11 p-3 font-bold text-primary">履歴へ戻る</a>
          </div>
        ) : (
          <LoaderCircle className="animate-spin text-primary" />
        )}
      </div>
    );

  const deleted = workout.deletedAt !== null;
  const syncLabel =
    savingLocally || syncState === 'syncing'
      ? '保存中…'
      : syncState === 'conflict'
        ? '競合あり'
        : syncState === 'error'
          ? '保存失敗・再試行'
          : syncState === 'pending'
            ? 'この端末に保存済み・同期待ち'
            : '保存済み';

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-7 lg:py-10">
      <a
        href={workout ? `${APP_ROUTES.history}?date=${workout.localDate}` : APP_ROUTES.history}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <ChevronLeft /> 履歴へ
      </a>

      {deleted ? (
        <Card className="rounded-3xl py-8"><CardContent className="space-y-4 px-6 text-center"><h1 className="text-2xl font-black">削除しました</h1><p className="text-sm text-muted-foreground">この記録は履歴に表示されません。</p><a href={APP_ROUTES.history} className={buttonVariants({ variant: 'outline' })}>履歴へ戻る</a></CardContent></Card>
      ) : (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {workout.status === 'completed' ? '完了済み' : '入力途中'}
              </Badge>
              <button
                type="button"
                data-sync-state={syncState}
                onClick={() => {
                  if (syncState === 'conflict') void reviewServer();
                  else if (syncState === 'error') void retrySync();
                }}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${syncState === 'error' ? 'bg-destructive/10 text-destructive' : syncState === 'saved' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
              >
                {savingLocally || syncState === 'syncing' ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : syncState === 'saved' ? (
                  <Check className="size-3" />
                ) : (
                  <CloudOff className="size-3" />
                )}
                {syncLabel}
              </button>
            </div>
            {!editing && (
              <>
                <h1 className="mt-3 text-3xl font-black">{workout.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {workout.localDate} · {workout.exercises.length}種目
                </p>
              </>
            )}
          </div>

          <ReviewConflictControl workoutId={workout.id} />

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm font-bold text-destructive"
            >
              {error}
            </p>
          )}

          {syncState === 'conflict' && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-black">競合あり</p>
                  <p className="mt-1">
                    別の変更が存在するため、自動同期を停止しました。ローカル編集内容は保持されています。
                  </p>
                  {serverReview && (
                    <p className="mt-2 text-xs font-bold">
                      端末の同期元: v{conflictBaseVersion ?? '—'} · サーバー側:
                      v{serverReview.version} · {serverReview.status}
                    </p>
                  )}
                  {serverReviewError && (
                    <p className="mt-2 text-xs font-bold text-destructive">
                      {serverReviewError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void reviewServer()}
                    className="mt-3 rounded-lg border bg-white px-3 py-1.5 text-xs font-black"
                  >
                    サーバー側を再確認
                  </button>
                </div>
              </div>
            </div>
          )}

          {editing ? (
            <CompletedWorkoutEditor
              workout={workout}
              saving={savingLocally || syncState === 'syncing'}
              onChange={(next) => void persistEdit(next)}
              onSave={() => void saveEdit()}
              onCancel={() => void cancelEdit()}
            />
          ) : (
            <>
              {workout.status === 'completed' && (
                <div className="space-y-3">
                  <Button
                    type="button"
                    className="h-12 w-full"
                    onClick={() => void startSameMenu()}
                    disabled={startingCopy || syncState === 'conflict'}
                  >
                    {startingCopy ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Play />
                    )}
                    {startingCopy ? '準備中…' : '同じメニューで開始'}
                  </Button>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11"
                      onClick={() => void beginEdit()}
                    >
                      <Pencil /> 編集
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            type="button"
                            variant="destructive"
                            className="h-11"
                          >
                            <Trash2 /> 削除
                          </Button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            このワークアウトを削除しますか？
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            この記録を削除します。削除すると元に戻せません。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>キャンセル</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => void deleteWorkout()}
                          >
                            削除する
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              )}
              {workout.status === 'completed' && !deleted && (
                <WorkoutProgressionSummary
                  workoutId={workout.id}
                  workoutVersion={workout.version}
                />
              )}
              {workout.exercises.map((exercise, exerciseIndex) => (
                <Card
                  key={exercise.id}
                  className="rounded-3xl py-5 shadow-none"
                >
                  <CardContent className="px-5">
                    <p className="text-xs font-bold text-primary">
                      EXERCISE {exerciseIndex + 1}
                    </p>
                    <h2 className="mt-1 text-xl font-black">
                      {exercise.exerciseNameSnapshot}
                    </h2>
                    <div className="mt-4 space-y-2">
                      {exercise.sets.map((set, setIndex) => (
                        <div
                          key={set.id}
                          className="rounded-xl bg-muted/65 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <span className="grid size-7 place-items-center rounded-full bg-card text-xs font-black">
                              {setIndex + 1}
                            </span>
                            {set.status === 'completed' && <Check className="size-4 shrink-0 text-primary" aria-label="完了" />}
                            {set.status === 'skipped' && <span className="text-xs text-muted-foreground">スキップ</span>}
                            <p className="font-black">
                              {set.actualLoadGrams === null
                                ? '—'
                                : `${set.actualLoadGrams / 1000} kg`}{' '}
                              × {repsLabel(set)}
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
                              × {set.targetRepMin ?? '—'}〜
                              {set.targetRepMax ?? '—'} 回
                            </p>
                          )}
                          {set.memo && (
                            <p className="mt-2 whitespace-pre-wrap break-words pl-10 text-sm text-muted-foreground">
                              {set.memo}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    {exercise.note && (
                      <p className="mt-4 whitespace-pre-wrap break-words rounded-xl border p-3 text-sm text-muted-foreground">
                        {exercise.note}
                      </p>
                    )}
                    <PastExerciseHistory exerciseId={exercise.exerciseId} localDate={workout.localDate} workoutId={workout.id} startedAt={workout.startedAt} />
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

            </>
          )}
        </>
      )}
    </div>
  );
}

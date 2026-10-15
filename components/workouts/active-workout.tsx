'use client';

import { reportInvalidWorkoutInput } from './validated-number-input';
import { useWorkoutView } from '@/hooks/use-workout-view';
import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Cloud,
  CloudOff,
  LoaderCircle,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  createWorkoutExercise,
  normalizePositions,
} from '@/lib/workouts/draft';
import type {
  ExerciseMaster,
  WorkoutExercise as WorkoutExerciseType,
} from '@/lib/workouts/types';
import { useActiveWorkout } from '@/hooks/use-active-workout';
import { useExerciseProgression } from '@/hooks/use-exercise-progression';
import { APP_ROUTES, navigateTo } from '@/lib/routes';
import { ExercisePicker } from './exercise-picker';
import { ReviewConflictControl } from './review-conflict-control';
import { WorkoutExercise } from './workout-exercise';

export function ActiveWorkout({ id }: { id: string }) {
  const {
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
  } = useActiveWorkout(id);
  const recordingRoot = useRef<HTMLDivElement>(null);
  const viewReady = Boolean(workout);
  useEffect(() => {
    if (!viewReady) return;
    const root = recordingRoot.current;
    const header = root?.querySelector('header');
    if (!root || !header) return;
    const measure = () => root.style.setProperty('--recording-header-height', `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [viewReady]);
  const [selectedId, setSelectedId] = useWorkoutView(id, Boolean(workout));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const effectiveSelectedId =
    selectedId &&
    workout?.exercises.some((exercise) => exercise.id === selectedId)
      ? selectedId
      : (workout?.exercises[0]?.id ?? null);
  const selected =
    workout?.exercises.find(
      (exercise) => exercise.id === effectiveSelectedId,
    ) ?? null;
  const progression = useExerciseProgression(selected?.exerciseId ?? null, workout?.localDate, workout?.startedAt, workout?.id);

  if (!workout)
    return (
      <div className="grid min-h-72 place-items-center px-6 py-10">
        <div className="text-center">
          {saveState === 'loading' ? (
            <LoaderCircle className="mx-auto size-7 animate-spin text-primary" />
          ) : (
            <>
              <AlertCircle className="mx-auto size-7 text-destructive" />
              <p className="mt-3 font-bold">
                {error ?? '読み込めませんでした'}
              </p>
              <Button className="mt-4 min-h-11" onClick={() => void retry()}>
                再試行
              </Button>
              <a href={APP_ROUTES.home} className="mt-4 block min-h-11 p-3 font-bold text-primary">
                ホームへ戻る
              </a>
            </>
          )}
        </div>
      </div>
    );

  if (workout.status === 'completed' && !finishing) return (
    <div className="mx-auto max-w-xl space-y-4 p-6 text-center">
      <Check className="mx-auto size-8 text-primary" />
      <h1 className="text-xl font-black">このトレーニングは終了済みです</h1>
      <p className="text-sm text-muted-foreground">{workout.name}</p>
      <a href={APP_ROUTES.workoutDetail(workout.id)} className="inline-block font-bold text-primary">完了した記録を確認する</a>
    </div>
  );

  const updateExercise = (next: WorkoutExerciseType) =>
    setWorkout((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) =>
        exercise.id === next.id ? next : exercise,
      ),
    }));
  const deleteExercise = (target: WorkoutExerciseType) => {
    if (
      !window.confirm(
        `${target.exerciseNameSnapshot}をこのワークアウトから削除しますか？`,
      )
    )
      return;
    setWorkout((current) => ({
      ...current,
      exercises: normalizePositions(
        current.exercises.filter((exercise) => exercise.id !== target.id),
      ),
    }));
  };
  const moveExercise = (target: WorkoutExerciseType, direction: -1 | 1) =>
    setWorkout((current) => {
      const items = [...current.exercises];
      const from = items.findIndex((item) => item.id === target.id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= items.length) return current;
      [items[from], items[to]] = [items[to], items[from]];
      return { ...current, exercises: normalizePositions(items) };
    });
  const addExercise = (master: ExerciseMaster) => {
    const created = createWorkoutExercise(master, workout.exercises.length);
    setWorkout((current) => ({
      ...current,
      exercises: [...current.exercises, created],
    }));
    setSelectedId(created.id);
  };
  const finish = async () => {
    if (reportInvalidWorkoutInput(recordingRoot.current)) return;
    if (
      !window.confirm(
        '入力済みのセットを確定してトレーニングを終了しますか？未入力のセットはスキップになります。終了後も履歴から編集できます。',
      )
    )
      return;
    setFinishing(true);
    setFinishError(null);
    try {
      const completed = await complete();
      navigateTo(APP_ROUTES.workoutDetail(completed.id));
    } catch (cause) {
      setFinishError(
        cause instanceof Error
          ? cause.message
          : 'ワークアウトを終了できませんでした',
      );
      setFinishing(false);
    }
  };

  return (
    <div ref={recordingRoot} className="mx-auto min-h-screen max-w-3xl bg-background pb-28">
      <header
        data-local-save-state={localSaveState}
        data-sync-state={saveState}
        className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="ホームへ戻る"
            onClick={() => navigateTo(APP_ROUTES.home)}
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0 text-center">
            <p className="truncate text-sm font-black">{workout.name}</p>
            <SaveIndicator
              state={saveState}
              error={error}
              onRetry={() => void retry()}
              onReview={() => void reviewServer()}
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="min-h-11"
            disabled={finishing}
            onClick={() => void finish()}
          >
            {finishing ? <LoaderCircle className="animate-spin" /> : <Check />}{' '}
            終了
          </Button>
        </div>
        {saveState === 'error' && error && (
          <div role="alert" className="mt-3 rounded-xl bg-destructive/5 p-3 text-xs">
            <p className="font-bold">{localSaveState === 'saved' ? 'この端末には保存済みです。サーバー同期に失敗しています。' : '端末の保存状態を確認してください。'}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-destructive">{error}</p>
            <a href={APP_ROUTES.settings} className="mt-2 inline-block font-bold text-primary">設定で同期状態を確認</a>
          </div>
        )}
        {workout.exercises.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {workout.exercises.map((exercise, index) => (
              <button
                key={exercise.id}
                type="button"
                onClick={() => setSelectedId(exercise.id)}
                className={`min-h-11 shrink-0 rounded-full px-3 py-2 text-xs font-bold transition ${exercise.id === effectiveSelectedId ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                {index + 1}. {exercise.exerciseNameSnapshot}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="grid size-11 shrink-0 place-items-center rounded-full border border-dashed"
              aria-label="種目を追加"
            >
              <Plus className="size-4" />
            </button>
          </div>
        )}
      </header>
      <main className="space-y-6 px-4 py-5">
        <ReviewConflictControl workoutId={workout.id} />
        {finishError && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive"
          >
            {finishError}
          </p>
        )}
        {localError && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 p-3 text-sm font-semibold text-destructive"
          >
            {localError}
          </p>
        )}
        {saveState === 'conflict' && (
          <div
            role="alert"
            className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-black">競合あり</p>
                <p className="mt-1">
                  別の変更が存在するため、自動同期を停止しました。ローカル記録はこの端末に保持されています。
                </p>
                {serverReview && (
                  <p className="mt-2 text-xs font-bold">
                    端末の同期元: v{conflictBaseVersion ?? '—'} · サーバー側: v
                    {serverReview.version} · {serverReview.status}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 bg-white"
                  onClick={() => void reviewServer()}
                >
                  サーバー側を再確認
                </Button>
              </div>
            </div>
          </div>
        )}
        {!selected ? (
          <div className="rounded-[28px] border border-dashed bg-card px-6 py-14 text-center">
            <p className="text-xl font-black">最初の種目を追加しましょう</p>
            <p className="mt-2 text-sm text-muted-foreground">
              部位ごとの一覧から選べます。作りたい種目がなければ、その場で追加できます。
            </p>
            <Button
              type="button"
              className="mt-6 h-12 rounded-xl px-6"
              onClick={() => setPickerOpen(true)}
            >
              <Plus /> 種目を追加
            </Button>
          </div>
        ) : (
          <WorkoutExercise
            key={selected.id}
            exercise={selected}
            workoutId={workout.id}
            localDate={workout.localDate}
            startedAt={workout.startedAt}
            progression={progression.state}
            onRetryProgression={progression.retry}
            isFirst={selected.position === 0}
            isLast={selected.position === workout.exercises.length - 1}
            onChange={updateExercise}
            onDelete={() => deleteExercise(selected)}
            onMove={(direction) => moveExercise(selected, direction)}
          />
        )}
        {workout.exercises.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full rounded-xl"
            onClick={() => setPickerOpen(true)}
          >
            <Plus /> 別の種目を追加
          </Button>
        )}
        <div className="rounded-2xl border bg-card p-4">
          <label htmlFor="workout-overall-note" className="text-sm font-bold">
            ワークアウト全体のメモ
          </label>
          <Textarea
            id="workout-overall-note"
            value={workout.overallNote}
            maxLength={4000}
            onChange={(event) =>
              setWorkout((current) => ({
                ...current,
                overallNote: event.target.value,
              }))
            }
            placeholder="体調や全体を通したメモ（任意）"
            className="mt-2 min-h-20 resize-none"
          />
        </div>
      </main>
      <ExercisePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludedIds={workout.exercises.map((exercise) => exercise.exerciseId)}
        onSelect={addExercise}
      />
    </div>
  );
}

function SaveIndicator({
  state,
  error,
  onRetry,
  onReview,
}: {
  state: 'loading' | 'saved' | 'saving' | 'pending' | 'error' | 'conflict';
  error: string | null;
  onRetry: () => void;
  onReview: () => void;
}) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" />
        保存中…
      </span>
    );
  if (state === 'pending')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700">
        <CloudOff className="size-3" />
        この端末に保存済み・同期待ち
      </span>
    );
  if (state === 'error')
    return (
      <button
        type="button"
        onClick={onRetry}
        title={error ?? undefined}
        className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive"
      >
        <CloudOff className="size-3" />
        同期失敗・再試行
      </button>
    );
  if (state === 'conflict')
    return (
      <button
        type="button"
        onClick={onReview}
        title={error ?? undefined}
        className="inline-flex items-center gap-1 text-[10px] font-black text-amber-800"
      >
        <AlertCircle className="size-3" />
        競合あり
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <Cloud className="size-3" />
      保存済み
    </span>
  );
}

'use client';

import { ArrowDown, ArrowUp, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createSet, normalizePositions } from '@/lib/workouts/draft';
import { compareWorkingSet } from '@/lib/progression/active-workout';
import type { ExerciseProgressionLoadState } from '@/hooks/use-exercise-progression';
import type {
  WorkoutExercise as WorkoutExerciseType,
  WorkoutSet,
} from '@/lib/workouts/types';
import { ExerciseSettingsReference } from './exercise-settings-reference';
import { WorkoutSetRow } from './workout-set-row';
import { ExerciseProgression } from './exercise-progression';
import { useExerciseHistory } from '@/hooks/use-exercise-history';
import { referenceAt } from '@/lib/workouts/history';
import { ExerciseHistory } from './exercise-history';

export function WorkoutExercise({
  exercise,
  workoutId,
  localDate,
  startedAt,
  progression = { status: 'idle', recommendation: null, error: null },
  onRetryProgression = () => undefined,
  isFirst,
  isLast,
  onChange,
  onDelete,
  onMove,
}: {
  exercise: WorkoutExerciseType;
  workoutId: string;
  localDate: string;
  startedAt: string;
  progression?: ExerciseProgressionLoadState;
  onRetryProgression?: () => void;
  isFirst: boolean;
  isLast: boolean;
  onChange: (exercise: WorkoutExerciseType) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const history = useExerciseHistory(
    exercise.exerciseId,
    localDate,
    workoutId,
    true,
    startedAt,
  );
  const updateSet = (next: WorkoutSet) => {
    const justCompleted = next.status === 'completed' && exercise.sets.find(set => set.id === next.id)?.status !== 'completed';
    onChange({
      ...exercise,
      sets: exercise.sets.map((set) => (set.id === next.id ? next : set)),
      updatedAt: new Date().toISOString(),
    });
    if (justCompleted) {
      const following = exercise.sets.find(set => set.id !== next.id && set.status !== 'completed' && set.status !== 'skipped');
      if (following) requestAnimationFrame(() => document.getElementById(`workout-set-${following.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
  const deleteSet = (id: string) =>
    onChange({
      ...exercise,
      sets: normalizePositions(exercise.sets.filter((set) => set.id !== id)),
      updatedAt: new Date().toISOString(),
    });
  const moveSet = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= exercise.sets.length) return;
    const sets = [...exercise.sets];
    [sets[index], sets[target]] = [sets[target], sets[index]];
    onChange({
      ...exercise,
      sets: normalizePositions(sets),
      updatedAt: new Date().toISOString(),
    });
  };
  const nextSet = exercise.sets.find(set => set.status !== 'completed' && set.status !== 'skipped');
  const completed = exercise.status === 'completed';
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-primary">
            EXERCISE {exercise.position + 1}
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">
            {exercise.exerciseNameSnapshot}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {exercise.sets.filter((set) => set.status === 'completed').length} /{' '}
            {exercise.sets.length} セット完了
          </p>
          <progress
            aria-label={`${exercise.exerciseNameSnapshot}のセット完了状況`}
            className="mt-2 h-2 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
            value={
              exercise.sets.filter((set) => set.status === 'completed').length
            }
            max={Math.max(exercise.sets.length, 1)}
          />
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            disabled={isFirst}
            aria-label="種目を前へ移動"
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11"
            disabled={isLast}
            aria-label="種目を後ろへ移動"
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="種目を削除"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {nextSet && <a className="flex min-h-11 items-center justify-center rounded-xl bg-primary/10 px-3 text-sm font-bold text-primary" href={`#workout-set-${nextSet.id}`}>次に取り組む SET {nextSet.position + 1} へ</a>}
      <ExerciseProgression
        exercise={exercise}
        state={progression}
        onRetry={onRetryProgression}
        onChange={onChange}
      />
      <ExerciseSettingsReference key={exercise.exerciseId} exerciseId={exercise.exerciseId} />
      <ExerciseHistory history={history} />
      <div className="space-y-3">
        {exercise.sets.map((set, index) => {
          const reference = referenceAt(history.references ?? history.items, set.position);
          const previous = reference?.set;
          return (
            <WorkoutSetRow
              key={set.id}
              set={set}
              number={index + 1}
              onChange={updateSet}
              canDelete={exercise.sets.length > 1}
              onDelete={() => deleteSet(set.id)}
              isFirst={index === 0}
              isLast={index === exercise.sets.length - 1}
              onMove={(direction) => moveSet(index, direction)}
              previousRecords={reference ? [{
                localDate: reference.entry.localDate, label: '直近の有効実績',
                set: reference.set, exerciseNote: reference.entry.note,
              }] : []}
              recentRecord={history.items[0]}
              isNext={set.id === exercise.sets.find(item => item.status !== 'completed' && item.status !== 'skipped')?.id}
              historyStatus={history.status}
              comparison={compareWorkingSet(
                {
                  ...set,
                  status: set.status === 'skipped' ? 'skipped' : 'completed',
                },
                previous ? { ...previous, deletedAt: null } : null,
              )}
            />
          );
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full rounded-xl border-dashed"
        onClick={() =>
          onChange({
            ...exercise,
            sets: [
              ...exercise.sets,
              createSet(exercise.sets.length, exercise.sets.at(-1)),
            ],
            updatedAt: new Date().toISOString(),
          })
        }
      >
        <Plus /> セットを追加
      </Button>
      <Textarea
        value={exercise.note}
        maxLength={2000}
        onChange={(event) =>
          onChange({
            ...exercise,
            note: event.target.value,
            updatedAt: new Date().toISOString(),
          })
        }
        placeholder="この種目全体のメモ（任意）"
        className="min-h-20 resize-none"
      />
      <Button
        type="button"
        variant={completed ? 'outline' : 'secondary'}
        className="h-11 w-full rounded-xl"
        onClick={() =>
          onChange({
            ...exercise,
            status: completed ? 'in_progress' : 'completed',
            completedAt: completed ? null : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        }
      >
        <CheckCircle2 /> {completed ? '種目を再開する' : 'この種目を完了'}
      </Button>
    </section>
  );
}

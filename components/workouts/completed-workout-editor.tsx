'use client';

import { Plus, Save, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  createWorkoutExercise,
  normalizePositions,
} from '@/lib/workouts/draft';
import type {
  ExerciseMaster,
  Workout,
  WorkoutExercise as WorkoutExerciseType,
} from '@/lib/workouts/types';
import { ExercisePicker } from './exercise-picker';
import { WorkoutExercise } from './workout-exercise';

export function CompletedWorkoutEditor({
  workout,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  workout: Workout;
  saving: boolean;
  onChange: (workout: Workout) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const patch = (values: Partial<Workout>) =>
    onChange({ ...workout, ...values, updatedAt: new Date().toISOString() });
  const updateExercise = (next: WorkoutExerciseType) =>
    patch({
      exercises: workout.exercises.map((exercise) =>
        exercise.id === next.id ? next : exercise,
      ),
    });
  const deleteExercise = (id: string) =>
    patch({
      exercises: normalizePositions(
        workout.exercises.filter((exercise) => exercise.id !== id),
      ),
    });
  const moveExercise = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= workout.exercises.length) return;
    const exercises = [...workout.exercises];
    [exercises[index], exercises[target]] = [
      exercises[target],
      exercises[index],
    ];
    patch({ exercises: normalizePositions(exercises) });
  };
  const addExercise = (master: ExerciseMaster) =>
    patch({
      exercises: [
        ...workout.exercises,
        createWorkoutExercise(master, workout.exercises.length),
      ],
    });

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl py-5 shadow-none">
        <CardContent className="grid gap-4 px-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="completed-workout-name"
              className="text-sm font-bold"
            >
              ワークアウト名
            </label>
            <Input
              id="completed-workout-name"
              value={workout.name}
              maxLength={80}
              onChange={(event) => patch({ name: event.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <label
              htmlFor="completed-workout-date"
              className="text-sm font-bold"
            >
              日付
            </label>
            <Input
              id="completed-workout-date"
              type="date"
              value={workout.localDate}
              onChange={(event) => patch({ localDate: event.target.value })}
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="completed-workout-rating"
              className="text-sm font-bold"
            >
              評価
            </label>
            <select
              id="completed-workout-rating"
              value={workout.rating ?? ''}
              onChange={(event) =>
                patch({
                  rating: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
              className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">未評価</option>
              {[1, 2, 3, 4, 5].map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="completed-workout-note"
              className="text-sm font-bold"
            >
              全体メモ
            </label>
            <Textarea
              id="completed-workout-note"
              value={workout.overallNote}
              maxLength={4000}
              onChange={(event) => patch({ overallNote: event.target.value })}
              className="mt-1 min-h-24 resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {workout.exercises.map((exercise, index) => (
        <Card key={exercise.id} className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <WorkoutExercise
              exercise={exercise}
              isFirst={index === 0}
              isLast={index === workout.exercises.length - 1}
              onChange={updateExercise}
              onDelete={() => deleteExercise(exercise.id)}
              onMove={(direction) => moveExercise(index, direction)}
            />
          </CardContent>
        </Card>
      ))}

      <Button
        type="button"
        variant="outline"
        className="h-12 w-full rounded-2xl border-dashed"
        onClick={() => setPickerOpen(true)}
      >
        <Plus /> 種目を追加
      </Button>

      <div className="sticky bottom-4 grid grid-cols-2 gap-3 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
        >
          <X /> キャンセル
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || !workout.name.trim()}
        >
          <Save /> {saving ? '保存中…' : '変更を保存'}
        </Button>
      </div>

      <ExercisePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludedIds={workout.exercises.map((exercise) => exercise.exerciseId)}
        onSelect={addExercise}
      />
    </div>
  );
}

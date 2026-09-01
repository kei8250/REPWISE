'use client';

import { ArrowDown, ArrowUp, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createSet, normalizePositions } from '@/lib/workouts/draft';
import type { WorkoutExercise as WorkoutExerciseType, WorkoutSet } from '@/lib/workouts/types';
import { WorkoutSetRow } from './workout-set-row';

export function WorkoutExercise({ exercise, isFirst, isLast, onChange, onDelete, onMove }: {
  exercise: WorkoutExerciseType;
  isFirst: boolean;
  isLast: boolean;
  onChange: (exercise: WorkoutExerciseType) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const updateSet = (next: WorkoutSet) => onChange({ ...exercise, sets: exercise.sets.map((set) => set.id === next.id ? next : set), updatedAt: new Date().toISOString() });
  const deleteSet = (id: string) => onChange({ ...exercise, sets: normalizePositions(exercise.sets.filter((set) => set.id !== id)), updatedAt: new Date().toISOString() });
  const completed = exercise.status === 'completed';
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-bold text-primary">EXERCISE {exercise.position + 1}</p><h2 className="mt-1 text-2xl font-black tracking-tight">{exercise.exerciseNameSnapshot}</h2><p className="mt-1 text-xs text-muted-foreground">{exercise.sets.filter((set) => set.status === 'completed').length} / {exercise.sets.length} セット完了</p></div>
        <div className="flex gap-1"><Button type="button" variant="outline" size="icon-sm" disabled={isFirst} aria-label="種目を前へ移動" onClick={() => onMove(-1)}><ArrowUp /></Button><Button type="button" variant="outline" size="icon-sm" disabled={isLast} aria-label="種目を後ろへ移動" onClick={() => onMove(1)}><ArrowDown /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label="種目を削除" onClick={onDelete}><Trash2 /></Button></div>
      </div>
      <div className="space-y-3">
        {exercise.sets.map((set, index) => <WorkoutSetRow key={set.id} set={set} number={index + 1} onChange={updateSet} canDelete={exercise.sets.length > 1} onDelete={() => deleteSet(set.id)} />)}
      </div>
      <Button type="button" variant="outline" className="h-11 w-full rounded-xl border-dashed" onClick={() => onChange({ ...exercise, sets: [...exercise.sets, createSet(exercise.sets.length, exercise.sets.at(-1))], updatedAt: new Date().toISOString() })}><Plus /> セットを追加</Button>
      <Textarea value={exercise.note} maxLength={2000} onChange={(event) => onChange({ ...exercise, note: event.target.value, updatedAt: new Date().toISOString() })} placeholder="この種目全体のメモ（任意）" className="min-h-20 resize-none" />
      <Button type="button" variant={completed ? 'outline' : 'secondary'} className="h-11 w-full rounded-xl" onClick={() => onChange({ ...exercise, status: completed ? 'in_progress' : 'completed', completedAt: completed ? null : new Date().toISOString(), updatedAt: new Date().toISOString() })}><CheckCircle2 /> {completed ? '種目を再開する' : 'この種目を完了'}</Button>
    </section>
  );
}

import type { WorkoutSet } from './types';

export interface WorkoutHistoryFilter {
  from?: string;
  to?: string;
  offset?: number;
}

export interface ExerciseHistoryEntry {
  workoutId: string;
  workoutExerciseId: string;
  workoutName: string;
  localDate: string;
  exerciseName: string;
  note: string;
  overallNote: string;
  sets: WorkoutSet[];
}

export interface ExerciseHistoryPage {
  items: ExerciseHistoryEntry[];
  hasMore: boolean;
}

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDateKey(date) === value;
}

export function defaultWorkoutName(localDate: string) {
  if (!isLocalDate(localDate)) return '今日のトレーニング';
  const [, month, day] = localDate.split('-').map(Number);
  return `${month}月${day}日のトレーニング`;
}

// Preserve set slots: a skipped or missing set must not shift later comparisons.
export function previousSetAt(
  entry: ExerciseHistoryEntry | undefined,
  position: number,
) {
  return entry?.sets.find((set) => set.position === position) ?? null;
}

export function setPerformanceLabel(
  set: Pick<WorkoutSet, 'actualLoadGrams' | 'actualReps'>,
) {
  return `${set.actualLoadGrams === null ? '—' : `${set.actualLoadGrams / 1000} kg`} × ${set.actualReps ?? '—'} 回`;
}

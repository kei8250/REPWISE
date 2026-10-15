import { repsLabel, hasSideReps, loadBasisLabel, setRoleLabel } from './reps';
import type { WorkoutSet } from './types';

export interface WorkoutHistoryFilter {
  from?: string;
  to?: string;
  offset?: number;
  exerciseName?: string;
  bodyPart?: string;
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
  references?: ExerciseHistoryEntry[];
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
  set: Pick<WorkoutSet, 'actualLoadGrams' | 'actualReps' | 'actualRepsLeft' | 'actualRepsRight' | 'role' | 'loadBasis'>,
) {
  return `${set.role && set.role !== 'standard' ? `${setRoleLabel(set.role)} · ` : ''}${set.actualLoadGrams === null ? '—' : `${set.actualLoadGrams / 1000} kg`} × ${repsLabel(set)}${hasSideReps(set) ? `（${loadBasisLabel(set.loadBasis)}）` : ''}`;
}

// Keep positions stable and reject planned/skipped sets even when they have inputs.
export function validReferenceSet(set: WorkoutSet) {
  return set.status === 'completed' && set.setType === 'working' &&
    set.actualLoadGrams !== null && Number.isInteger(set.actualLoadGrams) &&
    set.actualLoadGrams >= 0 && set.actualReps !== null &&
    Number.isInteger(set.actualReps) && set.actualReps > 0;
}

export function referenceAt(entries: ExerciseHistoryEntry[], position: number) {
  for (const entry of entries) {
    const set = previousSetAt(entry, position);
    if (set && validReferenceSet(set)) return { entry, set };
  }
  return null;
}

export function referenceForSet(entries: ExerciseHistoryEntry[], current: WorkoutSet, currentSets: WorkoutSet[]) {
  const role = current.role ?? 'standard';
  const ordinal = currentSets.filter(set => (set.role ?? 'standard') === role && set.position < current.position).length;
  for (const entry of entries) {
    const candidates = entry.sets.filter(set => (set.role ?? 'standard') === role).sort((a, b) => a.position - b.position);
    const set = role === 'standard' ? previousSetAt(entry, current.position) : candidates[ordinal];
    if (set && (set.role ?? 'standard') === role && (set.loadBasis ?? 'per_rep') === (current.loadBasis ?? 'per_rep') && validReferenceSet(set)) return { entry, set };
  }
  return null;
}

// Copying a reference is an explicit target edit, never an actual performance.
export function targetFromReference(set: WorkoutSet, reference: WorkoutSet): WorkoutSet {
  return { ...set, targetLoadGrams: reference.actualLoadGrams,
    targetRepMin: reference.actualReps, targetRepMax: reference.actualReps };
}

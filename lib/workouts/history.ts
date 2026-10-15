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

// Use the same role/position/load-basis matching as the set cards.
export function describeSetReferences(entries: ExerciseHistoryEntry[], sets: WorkoutSet[], status: 'loading' | 'success' | 'error') {
  if (status === 'loading') return { label: 'セット別の前回実績を確認中', detail: '' };
  if (status === 'error') return { label: '前回実績を取得できませんでした', detail: '過去の記録から再試行してください。記録がないとは限りません。' };
  const matched = sets.filter(set => referenceForSet(entries, set, sets));
  if (matched.length) return {
    label: 'セット別の前回実績を参照中',
    detail: `${matched.length} / ${sets.length}セットを参照できます。` + (matched.length < sets.length ? '参照できないセットには、有効な完了実績がないか、役割・セット位置・重量基準が一致する記録がありません。' : '日付・実績・メモは各セットで確認できます。'),
  };
  return entries.length
    ? { label: '比較条件に合う参考実績なし', detail: '有効な完了実績がないか、役割・セット位置・重量基準が一致する記録がありません。過去のメモは履歴から確認できます。' }
    : { label: '参考記録なし', detail: '参照できる過去の完了実績はありません。過去のメモは履歴から確認できます。' };
}

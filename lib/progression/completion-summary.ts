import type {
  ProgressionDecision,
  ProgressionExercisePerformance,
  ProgressionProfile,
  ProgressionReasonCode,
} from './engine';
import type { PersonalRecordEvaluation } from './personal-records';

export interface WorkoutCompletionProgressionExercise {
  workoutExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  position: number;
  profile: ProgressionProfile | null;
  performance: ProgressionExercisePerformance;
  decision: ProgressionDecision;
  personalRecords: PersonalRecordEvaluation;
}

export interface WorkoutCompletionProgressionSummary {
  workoutId: string;
  workoutVersion: number;
  totalExercises: number;
  counts: {
    increaseLoad: number;
    keepLoad: number;
    insufficientData: number;
  };
  exercises: WorkoutCompletionProgressionExercise[];
}

export function progressionStatusLabel(status: ProgressionDecision['status']) {
  if (status === 'increase_load') return '目標達成';
  if (status === 'keep_load') return '今回は同重量継続';
  return '判定できません';
}

const reasonLabels: Record<ProgressionReasonCode, string> = {
  all_sets_at_rep_max: '全セットで上限repを達成',
  within_rep_range: 'rep範囲内の実績',
  below_rep_min: '目標rep下限未満のセットあり',
  no_completed_history: '完了実績がありません',
  invalid_profile: '目標設定が不足しています',
  exercise_mismatch: '種目情報が一致しません',
  workout_not_completed: 'ワークアウトが未完了です',
  workout_deleted: '削除済みの記録です',
  exercise_not_completed: '種目が未完了です',
  working_set_count_mismatch: '必要セット数と一致しません',
  incomplete_working_set: '未完了セットがあります',
  invalid_actuals: '重量またはrepの記録が不足しています',
  inconsistent_load: '重量がセットごとに異なります',
};

export function progressionReasonLabel(reason: ProgressionReasonCode) {
  return reasonLabels[reason];
}

export function formatProgressionWeight(loadGrams: number) {
  return `${loadGrams / 1000}kg`;
}

export function formatWorkingSetPerformance(
  performance: ProgressionExercisePerformance,
) {
  const sets = performance.sets
    .filter((set) => !set.deletedAt && set.setType === 'working')
    .sort((left, right) => left.position - right.position);
  if (sets.length === 0) return 'working set記録なし';

  const valid = sets.every(
    (set) =>
      Number.isInteger(set.actualLoadGrams) &&
      (set.actualLoadGrams ?? 0) > 0 &&
      Number.isInteger(set.actualReps) &&
      (set.actualReps ?? 0) > 0,
  );
  if (!valid) return '実績入力が不足しています';

  const loads = new Set(sets.map((set) => set.actualLoadGrams));
  if (loads.size === 1) {
    return `${formatProgressionWeight(sets[0].actualLoadGrams as number)} × ${sets.map((set) => set.actualReps).join(' / ')}`;
  }
  return sets
    .map(
      (set) =>
        `${formatProgressionWeight(set.actualLoadGrams as number)}×${set.actualReps}`,
    )
    .join(' / ');
}

export function formatNextProgressionTarget(decision: ProgressionDecision) {
  const target = decision.nextTarget;
  if (!target) return null;
  return `${formatProgressionWeight(target.loadGrams)} / ${target.repMin}〜${target.repMax}回 × ${target.workingSets}セット`;
}

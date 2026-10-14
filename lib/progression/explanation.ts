import type {
  ProgressionExercisePerformance,
  ProgressionProfile,
} from './engine';

export function progressionProgress(
  performance: ProgressionExercisePerformance | null,
  profile: ProgressionProfile | null,
) {
  const working =
    performance?.sets.filter(
      (set) => !set.deletedAt && set.setType === 'working',
    ) ?? [];
  const valid = working.filter(
    (set) =>
      set.status === 'completed' &&
      Number.isInteger(set.actualLoadGrams) &&
      (set.actualLoadGrams ?? 0) > 0 &&
      Number.isInteger(set.actualReps) &&
      (set.actualReps ?? 0) > 0,
  );
  return {
    required: profile?.workingSets ?? null,
    recorded: working.length,
    completed: valid.length,
    atMinimum: profile
      ? valid.filter((set) => set.actualReps! >= profile.repMin).length
      : null,
    atMaximum: profile
      ? valid.filter((set) => set.actualReps! >= profile.repMax).length
      : null,
  };
}

export function progressionRule(profile: ProgressionProfile | null) {
  if (!profile)
    return '回数範囲・セット数・増量幅を種目設定で確認してください。';
  return `判定条件：完了した本番セット（working）、重量は0より大きい値（kgは小数可）、回数は1以上の整数。必要${profile.workingSets}セットが同重量で、全て${profile.repMax}回以上なら+${profile.incrementGrams / 1000}kg。それ以外は同重量で${profile.repMin}〜${profile.repMax}回を目指します。ウォームアップ・スキップ・削除済みは有効実績に含めません。セット枠数の不一致、未完了、入力不足、重量の混在では自動提案を保留します。0kgの実績は保存・前回参照できますが、自動増量判定の対象外です。`;
}

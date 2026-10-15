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
  return `判定条件：完了した本番セット（working）、重量は0より大きい値（kgは小数可）、回数は1以上の整数。同重量の一括判定では、必要${profile.workingSets}セットが揃い、全て${profile.repMax}回以上なら+${profile.incrementGrams / 1000}kg。それ以外は同重量で${profile.repMin}〜${profile.repMax}回を目指します。ウォームアップ・スキップ・削除済みは有効実績に含めません。左右別の回数は少ない側で判定します。セット数の不一致・未完了・入力不足では一括の提案を保留します。重量や役割が異なる場合は、実施した有効な完了セットだけを個別に判定します。各セットの保存済み回数範囲（未設定・不整合なら種目設定）に対して、上限達成ならそのセットだけ増量を提案します。未完了や未実施のセットは、個別の達成数や提案に含めません。0kgの実績は保存・前回参照できますが、自動増量判定の対象外です。`;
}

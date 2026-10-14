import type {
  ProgressionExercisePerformance,
  ProgressionProfile,
} from '@/lib/progression/engine';
import {
  progressionProgress,
  progressionRule,
} from '@/lib/progression/explanation';

export function ProgressionEvidence({
  performance,
  profile,
}: {
  performance: ProgressionExercisePerformance | null;
  profile: ProgressionProfile | null;
}) {
  const progress = progressionProgress(performance, profile);
  return (
    <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p>
        本番セット枠 {progress.recorded} · 有効な完了実績 {progress.completed} /
        必要 {progress.required ?? '未設定'}セット
      </p>
      {profile && (
        <p>
          現在の回数設定に対する達成：下限{profile.repMin}回以上{' '}
          {progress.atMinimum}セット / 上限{profile.repMax}回以上{' '}
          {progress.atMaximum}
          セット。自動判定ができない場合も、入力済みの実績は保持されます。
        </p>
      )}
      <p>{progressionRule(profile)}</p>
    </div>
  );
}

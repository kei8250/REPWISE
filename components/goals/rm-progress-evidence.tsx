import { RM_METHODS } from '@/lib/goals/rm';
import type { goalProgress } from '@/lib/goals/model';
import { formatKilograms } from '@/lib/analytics/detail-view';

export function RmProgressEvidence({
  progress,
}: {
  progress: ReturnType<typeof goalProgress>;
}) {
  const kg = (v: number) => formatKilograms(v, 2);
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        {RM_METHODS[progress.method].label} ·
        開始後の最高推定1RMで比較（1〜12回）
      </p>
      {progress.currentRmGrams && progress.targetRmGrams ? (
        <p>
          現在 {kg(progress.currentRmGrams)} ÷ 目標 {kg(progress.targetRmGrams)}{' '}
          × 100 ＝ {progress.percent}%
        </p>
      ) : (
        <p>
          {!progress.targetRmGrams
            ? '目標が13回以上のためRM換算は対象外です。'
            : '開始日以降にRM換算できる記録がまだありません。'}
        </p>
      )}
      {progress.actual && (
        <p>
          換算元：{progress.actual.localDate} · {kg(progress.actual.loadGrams)}{' '}
          × {progress.actual.bestReps}回
        </p>
      )}
      <p>
        {progress.achieved
          ? '目標重量・回数を実測で達成しました。'
          : progress.estimatedReached
            ? '換算上の目安に到達。目標重量・回数の実測達成はまだです。'
            : '推定値です。100%と実測の目標達成は別に判定します。'}
      </p>
      {progress.achieved && progress.directActual && (
        <p>
          実測達成の記録：{progress.directActual.localDate} ·{' '}
          {kg(progress.directActual.loadGrams)} ×{' '}
          {progress.directActual.bestReps}回
        </p>
      )}
    </div>
  );
}

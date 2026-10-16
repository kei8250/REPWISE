import type { AnalyticsPeriod, PeriodProgress, RepTrendPoint } from './model';

// Compare actual sets, never combine a weight and reps from different sets.
export function comparePeriodProgress(
  points: RepTrendPoint[],
  period: AnalyticsPeriod,
): PeriodProgress | null {
  const sorted = points
    .filter((p) => p.localDate <= period.endDate)
    .sort(
      (a, b) =>
        a.localDate.localeCompare(b.localDate) ||
        a.loadGrams - b.loadGrams ||
        a.bestReps - b.bestReps ||
        a.workoutId.localeCompare(b.workoutId),
    );
  const inRange = sorted.filter(
    (p) => !period.startDate || p.localDate >= period.startDate,
  );
  const after = inRange.at(-1);
  if (!after) return null;
  const boundary = new Date(`${period.endDate}T00:00:00Z`);
  boundary.setUTCDate(boundary.getUTCDate() - (period.dayCount ?? 0));
  const prior = period.dayCount
    ? sorted
        .filter((p) => p.localDate <= boundary.toISOString().slice(0, 10))
        .at(-1)
    : undefined;
  const first = inRange[0];
  // Choose the heaviest actual set (then most reps) from the baseline day.
  const before =
    prior ?? inRange.filter((p) => p.localDate === first?.localDate).at(-1);
  if (
    !before ||
    before.workoutId === after.workoutId ||
    before.localDate === after.localDate
  )
    return null;
  return {
    before,
    after,
    baseline: prior ? 'before_period' : 'first_in_period',
  };
}

export function periodProgressText(
  progress: PeriodProgress,
  period: AnalyticsPeriod,
) {
  const { before, after } = progress;
  const kg = (g: number) =>
    new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(
      g / 1000,
    );
  const label =
    progress.baseline === 'first_in_period'
      ? '期間内の初回と比較'
      : period.range === '7d'
        ? '1週間前を基準に比較'
        : period.range === '30d'
          ? '30日前（約1か月前）を基準に比較'
          : `${period.dayCount}日前を基準に比較`;
  const difference = after.loadGrams - before.loadGrams;
  const reps = after.bestReps - before.bestReps;
  const change =
    difference > 0
      ? `扱える重量が${kg(difference)}kgアップ！`
      : difference === 0 && reps > 0
        ? `同じ重量で${reps}回多くできました！`
        : difference === 0 && reps === 0
          ? '同じ重量・回数を維持しています'
          : '重量・回数の変化を確認しましょう';
  return {
    label,
    change,
    improved: difference > 0 || (difference === 0 && reps > 0),
    before: `${kg(before.loadGrams)}kg × ${before.bestReps}回`,
    after: `${kg(after.loadGrams)}kg × ${after.bestReps}回`,
  };
}

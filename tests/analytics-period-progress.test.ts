import { describe, expect, it } from 'vitest';
import {
  comparePeriodProgress,
  periodProgressText,
} from '@/lib/analytics/period-progress';
import { resolveAnalyticsPeriod } from '@/lib/analytics/engine';
import type { RepTrendPoint } from '@/lib/analytics/model';

const point = (
  localDate: string,
  loadGrams: number,
  bestReps: number,
  workoutId = localDate,
): RepTrendPoint => ({ localDate, loadGrams, bestReps, workoutId });

describe('period-specific actual set comparison', () => {
  const points = [
    point('2026-09-16', 50000, 8),
    point('2026-10-09', 55000, 8),
    point('2026-10-16', 55000, 10),
  ];
  it('compares 7 days ago and 30 days ago against the latest actual performance', () => {
    const week = resolveAnalyticsPeriod('7d', '2026-10-16');
    const month = resolveAnalyticsPeriod('30d', '2026-10-16');
    const weekly = comparePeriodProgress(points, week)!;
    const monthly = comparePeriodProgress(points, month)!;
    expect(weekly.before.localDate).toBe('2026-10-09');
    expect(periodProgressText(weekly, week)).toMatchObject({
      before: '55kg × 8回',
      after: '55kg × 10回',
      change: '同じ重量で2回多くできました！',
    });
    expect(monthly.before.localDate).toBe('2026-09-16');
    expect(periodProgressText(monthly, month).change).toBe(
      '扱える重量が5kgアップ！',
    );
  });
  it('does not invent a baseline when no record predates the selected period', () => {
    const period = resolveAnalyticsPeriod('7d', '2026-10-16');
    const result = comparePeriodProgress(
      [point('2026-10-12', 50000, 8), points[2]],
      period,
    )!;
    expect(result.baseline).toBe('first_in_period');
    expect(periodProgressText(result, period).label).toBe('期間内の初回と比較');
    expect(comparePeriodProgress([points[2]], period)).toBeNull();
  });
  it('keeps actual weight and reps paired, ignoring future records and avoiding same-day comparisons', () => {
    const period = resolveAnalyticsPeriod('7d', '2026-10-16');
    const result = comparePeriodProgress(
      [
        ...points,
        point('2026-10-16', 50000, 20),
        point('2026-10-17', 100000, 1),
      ],
      period,
    )!;
    expect(result.after).toEqual(points[2]);
    expect(
      comparePeriodProgress(
        [
          point('2026-10-16', 50000, 10, 'a'),
          point('2026-10-16', 55000, 8, 'b'),
        ],
        period,
      ),
    ).toBeNull();
  });
  it('compares all-time first and latest, without claiming improvement when weight or reps fell', () => {
    const period = resolveAnalyticsPeriod('all', '2026-10-16');
    const result = comparePeriodProgress(
      [points[0], point('2026-10-16', 45000, 12)],
      period,
    )!;
    expect(result.before).toEqual(points[0]);
    expect(periodProgressText(result, period).change).not.toContain('アップ');
  });
});
